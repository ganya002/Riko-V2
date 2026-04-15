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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelOption {
    pub model_id: String,
    pub display_name: String,
    pub reason: String,
    pub size_gb: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelCatalog {
    pub hardware: HardwareInfo,
    pub recommended_model_id: String,
    pub options: Vec<ModelOption>,
}

pub fn get_hardware_info() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_ram_gb = sys.total_memory() / (1024 * 1024 * 1024);
    let chip_name = get_chip_name();
    let lower_chip = chip_name.to_lowercase();
    let is_apple_silicon = lower_chip.contains("apple")
        || lower_chip.contains("m1")
        || lower_chip.contains("m2")
        || lower_chip.contains("m3")
        || lower_chip.contains("m4")
        || lower_chip.contains("m5");

    HardwareInfo { total_ram_gb, chip_name, is_apple_silicon }
}

fn get_chip_name() -> String {
    let profiler = std::process::Command::new("system_profiler")
        .args(["SPHardwareDataType"])
        .output();
    if let Ok(out) = profiler {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some(chip) = trimmed.strip_prefix("Chip:") {
                let chip = chip.trim();
                if !chip.is_empty() {
                    return chip.to_string();
                }
            }
            if let Some(chip) = trimmed.strip_prefix("Processor Name:") {
                let chip = chip.trim();
                if !chip.is_empty() {
                    return chip.to_string();
                }
            }
        }
    }

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

pub fn model_catalog(hw: &HardwareInfo) -> ModelCatalog {
    let machine = if hw.chip_name == "Unknown" {
        format!("your Mac with {}GB RAM", hw.total_ram_gb)
    } else {
        format!("your {} with {}GB RAM", hw.chip_name, hw.total_ram_gb)
    };

    let options = vec![
        ModelOption {
            model_id: "dolphin3:8b".to_string(),
            display_name: "Dolphin 3 · 8B".to_string(),
            reason: format!(
                "Fastest and safest default for {}. Best for MacBook Air and lower-memory machines.",
                machine
            ),
            size_gb: 4.9,
        },
        ModelOption {
            model_id: "dolphin-mixtral:8x7b".to_string(),
            display_name: "Dolphin Mixtral · 8x7B".to_string(),
            reason: format!(
                "A larger step up for {} if you want stronger reasoning and have real RAM headroom.",
                machine
            ),
            size_gb: 26.0,
        },
        ModelOption {
            model_id: "dolphin-llama3:70b".to_string(),
            display_name: "Dolphin Llama 3 · 70B".to_string(),
            reason: format!(
                "For very high-end Macs. Much larger and slower, but worthwhile when {} has lots of memory.",
                machine
            ),
            size_gb: 40.0,
        },
        ModelOption {
            model_id: "dolphin-mixtral:8x22b".to_string(),
            display_name: "Dolphin Mixtral · 8x22B".to_string(),
            reason: format!(
                "Only for workstation-class Macs. Pick this only when {} is a serious studio-class machine.",
                machine
            ),
            size_gb: 80.0,
        },
    ];

    let recommended_model_id = match hw.total_ram_gb {
        0..=24 => "dolphin3:8b",
        25..=63 => "dolphin-mixtral:8x7b",
        64..=127 => "dolphin-llama3:70b",
        _ => "dolphin-mixtral:8x22b",
    }
    .to_string();

    ModelCatalog {
        hardware: hw.clone(),
        recommended_model_id,
        options,
    }
}

pub fn recommend_model(hw: &HardwareInfo) -> ModelRecommendation {
    let catalog = model_catalog(hw);
    let option = catalog
        .options
        .into_iter()
        .find(|option| option.model_id == catalog.recommended_model_id)
        .unwrap_or(ModelOption {
            model_id: "dolphin3:8b".to_string(),
            display_name: "Dolphin 3 · 8B".to_string(),
            reason: "The safest default for most Macs.".to_string(),
            size_gb: 4.9,
        });

    ModelRecommendation {
        model_id: option.model_id,
        display_name: option.display_name,
        reason: option.reason,
        size_gb: option.size_gb,
    }
}
