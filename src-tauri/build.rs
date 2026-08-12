use std::{env, fs, path::PathBuf};

fn main() {
    let pins_path =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR fehlt"))
            .join("../config/toolchain-pins.json");
    let pins: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&pins_path).expect("config/toolchain-pins.json fehlt"),
    )
    .expect("config/toolchain-pins.json ist ungültig");
    let stockfish_version = pins["stockfish"]["version"]
        .as_str()
        .expect("stockfish.version fehlt in config/toolchain-pins.json");

    println!("cargo:rerun-if-changed={}", pins_path.display());
    println!("cargo:rustc-env=KIEBITZ_STOCKFISH_VERSION={stockfish_version}");
    tauri_build::build()
}
