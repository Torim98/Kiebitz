pub(crate) fn distribution_channel() -> &'static str {
    if cfg!(all(target_os = "android", feature = "play-store")) {
        "play-store"
    } else if cfg!(target_os = "android") {
        "sideload"
    } else {
        "desktop"
    }
}
