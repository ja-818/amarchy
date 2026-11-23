// The tray: the app goes on there when its window closes (so its
// notifications do), and comes back from it.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

pub fn make(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Amarchy", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Amarchy", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &reload, &PredefinedMenuItem::separator(app)?, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id("amarchy")
        .icon(icon)
        .tooltip("Amarchy")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::show(app),
            "reload" => {
                crate::show(app);
                crate::find(app);
            }
            "quit" => crate::quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // A click shows the window (where the system tells the app of
            // clicks: macOS, Windows; Linux's trays open the menu).
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// How many things need you, on the tray's tooltip (the app's count).
pub fn waiting(app: &AppHandle, n: u64) {
    if let Some(tray) = app.tray_by_id("amarchy") {
        let _ = tray.set_tooltip(Some(if n == 0 { "Amarchy".to_string() } else { format!("Amarchy · {n} need you") }));
    }
}
