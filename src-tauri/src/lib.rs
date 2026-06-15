use std::{
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

const SERVICE_URL: &str = "http://127.0.0.1:18777";

struct ManagedService(Mutex<Option<Child>>);

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .expect("failed to resolve project root")
}

fn bundled_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve bundled resource directory: {error}"))
}

fn bundled_resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = bundled_resource_dir(app)?;
    let direct_root = resource_dir.join("tauri-bundle");
    if direct_root.exists() {
        return Ok(direct_root);
    }

    let tauri_up_root = resource_dir.join("_up_/tauri-bundle");
    if tauri_up_root.exists() {
        return Ok(tauri_up_root);
    }

    Err(format!(
        "failed to locate bundled resources under {}",
        resource_dir.display()
    ))
}

fn spawn_prod_service(app: &AppHandle) -> Result<Child, String> {
    let bundle_root = bundled_resource_root(app)?;
    let node_path = bundle_root.join("runtime/node");
    let app_root = bundle_root.join("app");
    let service_path = app_root.join("src/server.js");
    let mut command = Command::new(&node_path);
    command
        .arg(&service_path)
        .current_dir(&app_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
        .spawn()
        .map_err(|error| format!("failed to launch bundled MD-Browser service: {error}"))
}

fn status_ready() -> Result<bool, String> {
    let mut stream = TcpStream::connect("127.0.0.1:18777").map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1200)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_millis(1200)))
        .map_err(|error| error.to_string())?;

    let request = concat!(
        "GET /api/status HTTP/1.1\r\n",
        "Host: 127.0.0.1:18777\r\n",
        "Connection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;

    let Some((head, body)) = response.split_once("\r\n\r\n") else {
        return Ok(false);
    };
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        return Ok(false);
    }

    Ok(
        body.contains("\"productName\": \"MD-Browser\"")
            || body.contains("\"productName\":\"MD-Browser\""),
    )
}

fn wait_for_service() -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        match status_ready() {
            Ok(true) => return Ok(()),
            Ok(false) | Err(_) => {}
        }
        sleep(Duration::from_millis(180));
    }
    Err("MD-Browser local service startup timed out.".into())
}

fn create_main_window(app: &AppHandle) -> Result<(), String> {
    let window_url = if cfg!(debug_assertions) {
        WebviewUrl::External(
            SERVICE_URL
                .parse::<Url>()
                .map_err(|error| error.to_string())?,
        )
    } else {
        WebviewUrl::App("index.html".into())
    };

    let window = WebviewWindowBuilder::new(app, "main", window_url)
        .title("MD-Browser")
        .inner_size(1320.0, 880.0)
        .min_inner_size(1080.0, 720.0)
        .visible(false)
        .build()
        .map_err(|error| format!("failed to create main window: {error}"))?;

    window
        .show()
        .map_err(|error| format!("failed to show main window: {error}"))?;

    Ok(())
}

fn setup_app(app: &AppHandle, service: &ManagedService) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        let child = spawn_prod_service(app)?;
        *service.0.lock().unwrap() = Some(child);
    } else {
        let _ = project_root();
    }

    wait_for_service()?;
    create_main_window(app)?;
    Ok(())
}

fn shutdown_service(service: &ManagedService) {
    let mut guard = service.0.lock().unwrap();
    let Some(mut child) = guard.take() else {
        return;
    };
    let _ = child.kill();
    let _ = child.wait();
}

pub fn run() {
    tauri::Builder::default()
        .manage(ManagedService(Mutex::new(None)))
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .map_err(|error| format!("failed to initialize updater plugin: {error}"))?;
            let service = app.state::<ManagedService>();
            setup_app(&app.handle(), &service).map_err(Into::into)
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |app_handle, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                let service = app_handle.state::<ManagedService>();
                shutdown_service(&service);
            }
        });
}
