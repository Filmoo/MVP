//! System tray: the app keeps running there so the UI can be fully closed
//! (freeing the webview) while League is in game.

use domain::Language;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager as _, Runtime};

use crate::core::UiLanguage;
use crate::window;

/// The menu's words in the UI's language.
struct Words {
    open: &'static str,
    quit: &'static str,
}

const fn words(language: Language) -> Words {
    match language {
        Language::Fr => Words {
            open: "Ouvrir",
            quit: "Quitter",
        },
        Language::Auto | Language::En => Words {
            open: "Open",
            quit: "Quit",
        },
    }
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let mut language = app.try_state::<UiLanguage>().map(|ui| ui.subscribe());
    let current = words(
        language
            .as_mut()
            .map_or(Language::En, |rx| *rx.borrow_and_update()),
    );
    let open = MenuItem::with_id(app, "open", current.open, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", current.quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    // Renamed when the UI's language changes.
    if let Some(mut language) = language {
        tauri::async_runtime::spawn(async move {
            while language.changed().await.is_ok() {
                let words = words(*language.borrow_and_update());
                if let Err(error) = open
                    .set_text(words.open)
                    .and_then(|()| quit.set_text(words.quit))
                {
                    tracing::warn!(%error, "cannot rename the tray menu");
                }
            }
        });
    }

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("MVP")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => window::open(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::open(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
