use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HardwareInfo {
    pub total_ram_gb: u64,
    pub chip_name: String,
    pub is_apple_silicon: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelRecommendation {
    pub model_id: String,
    pub display_name: String,
    pub reason: String,
    pub size_gb: f32,
}

pub fn get_hardware_info() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_ram_gb = sys.total_memory() / (1024 * 1024 * 1024);
    let chip_name = get_chip_name();
    let is_apple_silicon = chip_name.to_lowercase().contains("apple")
        || chip_name.to_lowercase().contains("m1")
        || chip_name.to_lowercase().contains("m2")
        || chip_name.to_lowercase().contains("m3")
        || chip_name.to_lowercase().contains("m4");

    HardwareInfo { total_ram_gb, chip_name, is_apple_silicon }
}

fn get_chip_name() -> String {
    let output = std::process::Command::new("sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output();
    if let Ok(out) = output {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() { return s; }
    }
    let output2 = std::process::Command::new("sysctl")
        .args(["-n", "hw.model"])
        .output();
    if let Ok(out) = output2 {
        return String::from_utf8_lossy(&out.stdout).trim().to_string();
    }
    "Unknown".to_string()
}

pub fn recommend_model(hw: &HardwareInfo) -> ModelRecommendation {
    match hw.total_ram_gb {
        0..=15 => ModelRecommendation {
            model_id: "dolphin3:8b".to_string(),
            display_name: "Dolphin 3 · 8B".to_string(),
            reason: format!(
                "Your Mac has {}GB RAM. The 8B model runs smoothly and gives Riko a solid brain.",
                hw.total_ram_gb
            ),
            size_gb: 4.9,
        },
        16..=31 => {
            if hw.is_apple_silicon {
                ModelRecommendation {
                    model_id: "dolphin3:8b".to_string(),
                    display_name: "Dolphin 3 · 8B".to_string(),
                    reason: format!(
                        "Your {} with {}GB unified RAM is perfect for the 8B model — fast responses.",
                        hw.chip_name, hw.total_ram_gb
                    ),
                    size_gb: 4.9,
                }
            } else {
                ModelRecommendation {
                    model_id: "dolphin3:8b".to_string(),
                    display_name: "Dolphin 3 · 8B".to_string(),
                    reason: format!(
                        "{}GB RAM detected. The 8B is the best fit for your system.",
                        hw.total_ram_gb
                    ),
                    size_gb: 4.9,
                }
            }
        }
        32..=63 => ModelRecommendation {
            model_id: "dolphin3:8b".to_string(),
            display_name: "Dolphin 3 · 8B".to_string(),
            reason: format!(
                "Your Mac has {}GB RAM — plenty of headroom. 8B runs blazing fast.",
                hw.total_ram_gb
            ),
            size_gb: 4.9,
        },
        _ => ModelRecommendation {
            // 64GB+: offer the larger 70B model
            model_id: "dolphin3:70b".to_string(),
            display_name: "Dolphin 3 · 70B".to_string(),
            reason: format!(
                "{}GB RAM detected — your machine can handle the 70B model. Riko at full power.",
                hw.total_ram_gb
            ),
            size_gb: 40.0,
        },
    }
}
