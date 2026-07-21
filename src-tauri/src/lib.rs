use std::fmt::Write as _;

use serde::Deserialize;
use tauri_plugin_dialog::DialogExt;

const MAX_ROUTE_NAME_CHARS: usize = 72;
const MAX_TRACK_POINTS: usize = 20_000;
const MAX_FILE_NAME_CHARS: usize = 96;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoutePoint {
    lat: f64,
    lon: f64,
    elevation: f64,
}

#[tauri::command]
async fn export_gpx(
    app: tauri::AppHandle,
    route_name: String,
    activity: String,
    file_name: String,
    points: Vec<RoutePoint>,
) -> Result<Option<String>, String> {
    validate_file_name(&file_name)?;
    let document = build_gpx_document(&route_name, &activity, &points)?;
    let selected_path = app
        .dialog()
        .file()
        .set_title("Export GPX Route")
        .set_file_name(&file_name)
        .add_filter("GPS Exchange Format", &["gpx"])
        .blocking_save_file();

    let Some(selected_path) = selected_path else {
        return Ok(None);
    };

    let mut path = selected_path
        .into_path()
        .map_err(|error| format!("Could not resolve the export location: {error}"))?;
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("gpx"))
    {
        path.set_extension("gpx");
    }

    std::fs::write(&path, document)
        .map_err(|error| format!("Could not save the GPX file: {error}"))?;

    Ok(Some(path.display().to_string()))
}

fn validate_file_name(file_name: &str) -> Result<(), String> {
    let character_count = file_name.chars().count();
    let valid_characters = file_name
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character));

    let has_gpx_extension = std::path::Path::new(file_name)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("gpx"));

    if character_count == 0
        || character_count > MAX_FILE_NAME_CHARS
        || !valid_characters
        || !has_gpx_extension
    {
        return Err("The GPX file name is not valid.".to_owned());
    }

    Ok(())
}

fn validate_route<'a>(
    route_name: &'a str,
    activity: &str,
    points: &[RoutePoint],
) -> Result<(&'a str, &'static str), String> {
    let route_name = route_name.trim();
    let route_name_length = route_name.chars().count();

    if route_name_length == 0 || route_name_length > MAX_ROUTE_NAME_CHARS {
        return Err(format!(
            "Route name must be between 1 and {MAX_ROUTE_NAME_CHARS} characters."
        ));
    }
    if points.len() < 2 {
        return Err("A route needs at least two track points before export.".to_owned());
    }
    if points.len() > MAX_TRACK_POINTS {
        return Err(format!(
            "A route may contain at most {MAX_TRACK_POINTS} track points."
        ));
    }

    for point in points {
        if !point.lat.is_finite()
            || !point.lon.is_finite()
            || !point.elevation.is_finite()
            || !(-90.0..=90.0).contains(&point.lat)
            || !(-180.0..=180.0).contains(&point.lon)
            || !(-500.0..=30_000.0).contains(&point.elevation)
        {
            return Err("The route contains an invalid track point.".to_owned());
        }
    }

    let activity_name = match activity {
        "trail-run" => "Trail Running",
        "mtb" => "Mountain Biking",
        _ => return Err("Activity must be trail running or mountain biking.".to_owned()),
    };

    Ok((route_name, activity_name))
}

fn build_gpx_document(
    route_name: &str,
    activity: &str,
    points: &[RoutePoint],
) -> Result<String, String> {
    let (route_name, activity_name) = validate_route(route_name, activity, points)?;
    let escaped_name = xml_escape(route_name);
    let mut document = String::with_capacity(points.len() * 72 + 640);

    document.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    document.push_str(
        "<gpx version=\"1.1\" creator=\"RIDGELINE\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\">\n",
    );
    writeln!(
        document,
        "  <metadata><name>{escaped_name}</name><desc>{activity_name} route exported by RIDGELINE</desc></metadata>"
    )
    .expect("writing to a String cannot fail");
    writeln!(
        document,
        "  <trk><name>{escaped_name}</name><type>{activity_name}</type><trkseg>"
    )
    .expect("writing to a String cannot fail");

    for point in points {
        writeln!(
            document,
            "    <trkpt lat=\"{:.7}\" lon=\"{:.7}\"><ele>{:.1}</ele></trkpt>",
            point.lat, point.lon, point.elevation
        )
        .expect("writing to a String cannot fail");
    }

    document.push_str("  </trkseg></trk>\n</gpx>\n");
    Ok(document)
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Starts the Tauri application and blocks until its event loop exits.
///
/// # Panics
///
/// Panics if Tauri cannot initialize or its event loop exits with an error.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![export_gpx])
        .run(tauri::generate_context!())
        .expect("error while running the RIDGELINE application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_points() -> Vec<RoutePoint> {
        vec![
            RoutePoint {
                lat: 47.5098,
                lon: -121.8975,
                elevation: 1_760.0,
            },
            RoutePoint {
                lat: 47.5439,
                lon: -121.9859,
                elevation: 2_953.0,
            },
        ]
    }

    #[test]
    fn builds_valid_gpx_track() {
        let document = build_gpx_document("Tiger Mountain Traverse", "trail-run", &sample_points())
            .expect("valid route should produce GPX");

        assert!(document.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>"));
        assert!(document.contains("<name>Tiger Mountain Traverse</name>"));
        assert!(document.contains("<type>Trail Running</type>"));
        assert_eq!(document.matches("<trkpt ").count(), 2);
    }

    #[test]
    fn escapes_route_names_for_xml() {
        let document = build_gpx_document("Ridge & Creek <Loop>", "mtb", &sample_points())
            .expect("valid route should produce GPX");

        assert!(document.contains("Ridge &amp; Creek &lt;Loop&gt;"));
        assert!(document.contains("<type>Mountain Biking</type>"));
    }

    #[test]
    fn rejects_invalid_routes() {
        assert!(build_gpx_document("", "trail-run", &sample_points()).is_err());
        assert!(build_gpx_document("Route", "road-bike", &sample_points()).is_err());
        assert!(build_gpx_document("Route", "mtb", &sample_points()[..1]).is_err());
    }

    #[test]
    fn validates_export_file_names() {
        assert!(validate_file_name("tiger-mountain.gpx").is_ok());
        assert!(validate_file_name("../route.gpx").is_err());
        assert!(validate_file_name("route.xml").is_err());
    }
}
