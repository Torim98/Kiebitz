//! Titelleiste unter Windows 11.
//!
//! Windows zeichnet die Leiste weiterhin selbst · Snap Layouts, Fensterschatten,
//! Größenänderung und die nativen Fensterbuttons bleiben damit erhalten. Über
//! die DWM-Attribute bekommt sie nur die Farben von Kiebitz: dieselben Werte
//! wie `--color-panel`, `--color-ink` und `--color-line` in `src/index.css`.
//!
//! Der Gegenentwurf wäre `decorations: false` plus eine eigene React-Leiste.
//! Für reine Farbgebung ist das unnötig aufwendig · Ziehbereich, Doppelklick-
//! Maximieren und Aero-Snap müssten von Hand nachgebaut werden.
//!
//! Das dunkle Kontextmenü und die dunklen Hover-Flächen der Fensterbuttons
//! kommen nicht von hier, sondern von `"theme": "Dark"` in tauri.conf.json.
//!
//! Die Farb-Attribute gibt es erst ab Windows 11 (Build 22000). Ältere Systeme
//! antworten mit E_INVALIDARG; das ist kein Fehlerfall, dort bleibt schlicht
//! die Systemleiste stehen.

use std::ffi::c_void;

const DWMWA_BORDER_COLOR: u32 = 34;
const DWMWA_CAPTION_COLOR: u32 = 35;
const DWMWA_TEXT_COLOR: u32 = 36;

/// COLORREF ist 0x00BBGGRR · also genau andersherum als ein CSS-Hex.
const fn colorref(rgb: u32) -> u32 {
    ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
}

/// `--color-panel` · dieselbe Fläche wie Sidebar und Karten.
const CAPTION: u32 = colorref(0x171716);
/// `--color-ink` · Fenstertitel und Symbole. Inaktiv dimmt Windows selbst.
const TEXT: u32 = colorref(0xf2f1ec);
/// `--color-line` · dieselbe Trennlinie wie im Layout.
const BORDER: u32 = colorref(0x292927);

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(hwnd: *mut c_void, attr: u32, value: *const c_void, size: u32) -> i32;
}

/// Färbt Titelleiste, Titeltext und Fensterrahmen. Schlägt das fehl, bleibt es
/// bei den Systemfarben · ein Grund, das Fenster nicht zu zeigen, ist es nicht.
pub fn apply(window: &tauri::WebviewWindow) {
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd.0 as isize as *mut c_void,
        Err(e) => {
            log::warn!("Titelleiste: kein Fensterhandle ({e}) · Systemfarben bleiben");
            return;
        }
    };
    set(hwnd, DWMWA_CAPTION_COLOR, CAPTION);
    set(hwnd, DWMWA_TEXT_COLOR, TEXT);
    set(hwnd, DWMWA_BORDER_COLOR, BORDER);
}

fn set(hwnd: *mut c_void, attr: u32, value: u32) {
    // SAFETY: `hwnd` stammt aus dem laufenden Fenster, und `value` lebt über den
    // Aufruf hinaus · DWM kopiert den Wert, es wird nichts festgehalten.
    let hr = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attr,
            std::ptr::from_ref(&value).cast::<c_void>(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    if hr < 0 {
        log::debug!(
            "Titelleiste: Attribut {attr} abgelehnt (HRESULT {hr:#010x}) · vor Windows 11?"
        );
    }
}
