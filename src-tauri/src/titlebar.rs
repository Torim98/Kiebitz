//! Titelleiste unter Windows 11.
//!
//! Windows zeichnet die Leiste weiterhin selbst · Snap Layouts, Fensterschatten,
//! Größenänderung und die nativen Fensterbuttons bleiben damit erhalten. Über
//! die DWM-Attribute bekommt sie nur die Farben von Kiebitz: dieselben Werte
//! wie `--color-panel`, `--color-ink` und `--color-line` in `src/themes.css`.
//!
//! Der Gegenentwurf wäre `decorations: false` plus eine eigene React-Leiste.
//! Für reine Farbgebung ist das unnötig aufwendig · Ziehbereich, Doppelklick-
//! Maximieren und Aero-Snap müssten von Hand nachgebaut werden.
//!
//! Welche Farben gelten, weiß nur die Oberfläche: Die Themen stehen
//! ausschließlich in `src/themes.css`, und ein zweiter Farbsatz in Rust würde
//! genau dann auseinanderlaufen, wenn jemand ein Thema anpasst. Deshalb misst
//! `src/lib/theme.ts` die Tokens nach jedem Themenwechsel am <html> und meldet
//! sie über `set_titlebar` hierher. Beim Start steht bis zur ersten Meldung
//! `DARK` · das ist der Grundton des Standardthemas.
//!
//! Ob die Fensterbuttons hell oder dunkel hovern und welche Farbe das
//! Systemmenü hat, hängt an `DWMWA_USE_IMMERSIVE_DARK_MODE`. Das Attribut
//! betrifft nur den Fensterrahmen; `prefers-color-scheme` im Webview bleibt
//! davon unberührt (anders als bei `window.set_theme`), sonst geriete der
//! Systemabgleich der Themen mit sich selbst in eine Schleife.
//!
//! Die Farb-Attribute gibt es erst ab Windows 11 (Build 22000). Ältere Systeme
//! antworten mit E_INVALIDARG; das ist kein Fehlerfall, dort bleibt schlicht
//! die Systemleiste stehen.

/// Was die Leiste braucht · Hex-Werte, wie sie in `themes.css` stehen.
// Ohne Windows liest die Umsetzung unten keines der Felder · das ist der Sinn
// der Sache und kein toter Code.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug)]
pub struct Colors {
    /// `--color-panel` · dieselbe Fläche wie Sidebar und Karten.
    pub caption: u32,
    /// `--color-ink` · Fenstertitel und Symbole. Inaktiv dimmt Windows selbst.
    pub text: u32,
    /// `--color-line` · dieselbe Trennlinie wie im Layout.
    pub border: u32,
    /// Helle Schrift auf dunkler Leiste? Steuert Hover und Systemmenü.
    pub dark: bool,
}

/// Der Grundton des Standardthemas · gilt, bis die Oberfläche sich meldet.
pub const DARK: Colors = Colors {
    caption: 0x171716,
    text: 0xf2f1ec,
    border: 0x292927,
    dark: true,
};

/// Nimmt die gemessenen Tokens der Oberfläche entgegen. Ungültige Werte werden
/// verworfen, statt die Leiste in eine Verlegenheitsfarbe zu ziehen.
#[tauri::command]
pub fn set_titlebar(
    window: tauri::WebviewWindow,
    caption: String,
    text: String,
    border: String,
    dark: bool,
) -> Result<(), String> {
    let colors = Colors {
        caption: hex(&caption).ok_or_else(|| format!("Titelleiste: Farbe „{caption}“ unlesbar"))?,
        text: hex(&text).ok_or_else(|| format!("Titelleiste: Farbe „{text}“ unlesbar"))?,
        border: hex(&border).ok_or_else(|| format!("Titelleiste: Farbe „{border}“ unlesbar"))?,
        dark,
    };
    apply(&window, colors);
    Ok(())
}

/// `#rrggbb` (auch ohne Raute, auch `#rgb`) → 0xRRGGBB.
fn hex(value: &str) -> Option<u32> {
    let digits = value.trim().trim_start_matches('#');
    match digits.len() {
        3 => {
            let short = u32::from_str_radix(digits, 16).ok()?;
            // Jede Ziffer verdoppeln · #abc ist #aabbcc.
            let expand = |shift: u32| {
                let nibble = (short >> shift) & 0xf;
                nibble << 4 | nibble
            };
            Some(expand(8) << 16 | expand(4) << 8 | expand(0))
        }
        6 => u32::from_str_radix(digits, 16).ok(),
        // Acht Stellen kämen von einem Token mit Alpha · die Leiste ist
        // undurchsichtig, also die Deckkraft abschneiden.
        8 => u32::from_str_radix(&digits[..6], 16).ok(),
        _ => None,
    }
}

#[cfg(windows)]
mod imp {
    use super::Colors;
    use std::ffi::c_void;

    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_BORDER_COLOR: u32 = 34;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;

    /// COLORREF ist 0x00BBGGRR · also genau andersherum als ein CSS-Hex.
    const fn colorref(rgb: u32) -> u32 {
        ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attr: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    /// Färbt Titelleiste, Titeltext und Fensterrahmen. Schlägt das fehl, bleibt
    /// es bei den Systemfarben · ein Grund, das Fenster nicht zu zeigen, ist es
    /// nicht.
    pub fn apply(window: &tauri::WebviewWindow, colors: Colors) {
        let hwnd = match window.hwnd() {
            Ok(hwnd) => hwnd.0 as isize as *mut c_void,
            Err(e) => {
                log::warn!("Titelleiste: kein Fensterhandle ({e}) · Systemfarben bleiben");
                return;
            }
        };
        // Der Modus zuerst: Windows zeichnet die Leiste beim Umschalten neu und
        // nimmt die Farben unten dann in einem Zug mit, statt zu flackern.
        set(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, u32::from(colors.dark));
        set(hwnd, DWMWA_CAPTION_COLOR, colorref(colors.caption));
        set(hwnd, DWMWA_TEXT_COLOR, colorref(colors.text));
        set(hwnd, DWMWA_BORDER_COLOR, colorref(colors.border));
    }

    fn set(hwnd: *mut c_void, attr: u32, value: u32) {
        // SAFETY: `hwnd` stammt aus dem laufenden Fenster, und `value` lebt über
        // den Aufruf hinaus · DWM kopiert den Wert, es wird nichts festgehalten.
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
}

/// Überall sonst zeichnet das System die Leiste allein · der Befehl bleibt
/// trotzdem angemeldet, damit die Oberfläche keine Plattformabfrage braucht.
#[cfg(not(windows))]
mod imp {
    use super::Colors;

    pub fn apply(_window: &tauri::WebviewWindow, _colors: Colors) {}
}

pub use imp::apply;

#[cfg(test)]
mod tests {
    use super::hex;

    #[test]
    fn reads_the_tokens_as_they_stand_in_the_stylesheet() {
        assert_eq!(hex("#171716"), Some(0x171716));
        assert_eq!(hex(" f2f1ec "), Some(0xf2f1ec));
        assert_eq!(hex("#abc"), Some(0xaabbcc));
        // Deckkraft eines Tokens wie --color-overlay fällt weg.
        assert_eq!(hex("#0e0e0dd9"), Some(0x0e0e0d));
    }

    #[test]
    fn refuses_anything_that_is_not_a_hex_colour() {
        assert_eq!(hex("rgb(23, 23, 22)"), None);
        assert_eq!(hex(""), None);
        assert_eq!(hex("#12345"), None);
        assert_eq!(hex("#gggggg"), None);
    }
}
