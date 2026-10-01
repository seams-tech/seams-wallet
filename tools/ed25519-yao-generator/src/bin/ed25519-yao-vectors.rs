use std::env;
use std::fs;
use std::path::Path;

use ed25519_yao_generator::{
    canonical_activation_delivery_vector_corpus_json_bytes_v1,
    canonical_activation_delivery_vector_corpus_v1,
    canonical_activation_recipient_party_view_vector_corpus_json_bytes_v1,
    canonical_activation_recipient_party_view_vector_corpus_v1,
    canonical_ceremony_context_vector_corpus_v1,
    canonical_evaluation_input_party_view_vector_corpus_json_bytes_v1,
    canonical_evaluation_input_party_view_vector_corpus_v1,
    canonical_evaluator_abort_view_vector_corpus_json_bytes_v1,
    canonical_evaluator_abort_view_vector_corpus_v1,
    canonical_export_delivery_vector_corpus_json_bytes_v1,
    canonical_export_delivery_vector_corpus_v1,
    canonical_export_evaluator_authorization_vector_corpus_json_bytes_v1,
    canonical_export_evaluator_authorization_vector_corpus_v1, canonical_kdf_vector_corpus_v1,
    canonical_lifecycle_continuity_corpus_v1,
    canonical_output_party_view_vector_corpus_json_bytes_v1,
    canonical_output_party_view_vector_corpus_v1,
    canonical_output_sharing_vector_corpus_json_bytes_v1,
    canonical_output_sharing_vector_corpus_v1,
    canonical_phase2b_core_reconciliation_corpus_json_bytes_v1,
    canonical_phase2b_core_reconciliation_corpus_v1, canonical_provenance_vector_corpus_v1,
    canonical_recovery_credential_transition_vector_corpus_json_bytes_v1,
    canonical_recovery_credential_transition_vector_corpus_v1,
    canonical_recovery_evaluator_admission_vector_corpus_json_bytes_v1,
    canonical_recovery_evaluator_admission_vector_corpus_v1,
    canonical_refresh_evaluator_admission_vector_corpus_json_bytes_v1,
    canonical_refresh_evaluator_admission_vector_corpus_v1,
    canonical_registration_evaluator_admission_vector_corpus_json_bytes_v1,
    canonical_registration_evaluator_admission_vector_corpus_v1,
    canonical_semantic_frame_party_view_vector_corpus_json_bytes_v1,
    canonical_semantic_frame_party_view_vector_corpus_v1,
    canonical_semantic_lifecycle_vector_corpus_json_bytes_v1,
    canonical_semantic_lifecycle_vector_corpus_v1,
    canonical_uniform_abort_vector_corpus_json_bytes_v1, canonical_uniform_abort_vector_corpus_v1,
    canonical_vector_corpus_v1, differential_vector_corpus_v1,
    parse_canonical_activation_delivery_vector_corpus_json_v1,
    parse_canonical_activation_recipient_party_view_vector_corpus_json_v1,
    parse_canonical_evaluation_input_party_view_vector_corpus_json_v1,
    parse_canonical_evaluator_abort_view_vector_corpus_json_v1,
    parse_canonical_export_delivery_vector_corpus_json_v1,
    parse_canonical_export_evaluator_authorization_vector_corpus_json_v1,
    parse_canonical_output_party_view_vector_corpus_json_v1,
    parse_canonical_output_sharing_vector_corpus_json_v1,
    parse_canonical_phase2b_core_reconciliation_corpus_json_v1,
    parse_canonical_recovery_credential_transition_vector_corpus_json_v1,
    parse_canonical_recovery_evaluator_admission_vector_corpus_json_v1,
    parse_canonical_refresh_evaluator_admission_vector_corpus_json_v1,
    parse_canonical_registration_evaluator_admission_vector_corpus_json_v1,
    parse_canonical_semantic_frame_party_view_vector_corpus_json_v1,
    parse_canonical_semantic_lifecycle_vector_corpus_json_v1,
    parse_canonical_uniform_abort_vector_corpus_json_v1, CeremonyContextVectorCorpusV1,
    KdfVectorCorpusV1, LifecycleContinuityCorpusV1, ProvenanceVectorCorpusV1, VectorCorpusV1,
};
use serde::de::DeserializeOwned;
use serde::Serialize;

type CliResult<T> = Result<T, Box<dyn std::error::Error>>;

/// A corpus whose library module owns its exact encoding: `emit-<name>` writes the canonical
/// bytes and `check-<name>` accepts only those bytes.
struct CanonicalCorpus {
    name: &'static str,
    label: &'static str,
    case_count: fn() -> usize,
    bytes: fn() -> Vec<u8>,
    check: fn(&[u8]) -> CliResult<usize>,
}

/// Listed in usage order.
const CANONICAL_CORPORA: [CanonicalCorpus; 16] = [
    CanonicalCorpus {
        name: "output-sharing",
        label: "output-sharing",
        case_count: || canonical_output_sharing_vector_corpus_v1().case_count(),
        bytes: canonical_output_sharing_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_output_sharing_vector_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "output-party-views",
        label: "output-party-view",
        case_count: || canonical_output_party_view_vector_corpus_v1().case_count(),
        bytes: canonical_output_party_view_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_output_party_view_vector_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "export-delivery",
        label: "export-delivery",
        case_count: || canonical_export_delivery_vector_corpus_v1().case_count(),
        bytes: canonical_export_delivery_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_export_delivery_vector_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "export-evaluator-authorization",
        label: "export evaluator-authorization",
        case_count: || canonical_export_evaluator_authorization_vector_corpus_v1().case_count(),
        bytes: canonical_export_evaluator_authorization_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_export_evaluator_authorization_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
    CanonicalCorpus {
        name: "registration-evaluator-admission",
        label: "registration evaluator-admission",
        case_count: || canonical_registration_evaluator_admission_vector_corpus_v1().case_count(),
        bytes: canonical_registration_evaluator_admission_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_registration_evaluator_admission_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
    CanonicalCorpus {
        name: "recovery-evaluator-admission",
        label: "recovery evaluator-admission",
        case_count: || canonical_recovery_evaluator_admission_vector_corpus_v1().case_count(),
        bytes: canonical_recovery_evaluator_admission_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_recovery_evaluator_admission_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
    CanonicalCorpus {
        name: "refresh-evaluator-admission",
        label: "refresh evaluator-admission",
        case_count: || canonical_refresh_evaluator_admission_vector_corpus_v1().case_count(),
        bytes: canonical_refresh_evaluator_admission_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_refresh_evaluator_admission_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
    CanonicalCorpus {
        name: "semantic-frame-party-views",
        label: "semantic-frame party-view",
        case_count: || canonical_semantic_frame_party_view_vector_corpus_v1().case_count(),
        bytes: canonical_semantic_frame_party_view_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_semantic_frame_party_view_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
    CanonicalCorpus {
        name: "phase2b-core-reconciliation",
        label: "Phase 2B core-reconciliation",
        case_count: || canonical_phase2b_core_reconciliation_corpus_v1().case_count(),
        bytes: canonical_phase2b_core_reconciliation_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_phase2b_core_reconciliation_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "activation-delivery",
        label: "activation-delivery",
        case_count: || canonical_activation_delivery_vector_corpus_v1().case_count(),
        bytes: canonical_activation_delivery_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_activation_delivery_vector_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "activation-recipient-party-views",
        label: "activation recipient-party-view",
        case_count: || canonical_activation_recipient_party_view_vector_corpus_v1().case_count(),
        bytes: canonical_activation_recipient_party_view_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_activation_recipient_party_view_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
    CanonicalCorpus {
        name: "evaluation-input-party-views",
        label: "evaluation-input party-view",
        case_count: || canonical_evaluation_input_party_view_vector_corpus_v1().case_count(),
        bytes: canonical_evaluation_input_party_view_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_evaluation_input_party_view_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
    CanonicalCorpus {
        name: "semantic-lifecycle",
        label: "semantic-lifecycle",
        case_count: || canonical_semantic_lifecycle_vector_corpus_v1().case_count(),
        bytes: canonical_semantic_lifecycle_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_semantic_lifecycle_vector_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "uniform-abort",
        label: "uniform-abort",
        case_count: || canonical_uniform_abort_vector_corpus_v1().case_count(),
        bytes: canonical_uniform_abort_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_uniform_abort_vector_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "evaluator-abort-views",
        label: "evaluator-abort state/party-view",
        case_count: || canonical_evaluator_abort_view_vector_corpus_v1().case_count(),
        bytes: canonical_evaluator_abort_view_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(parse_canonical_evaluator_abort_view_vector_corpus_json_v1(encoded)?.case_count())
        },
    },
    CanonicalCorpus {
        name: "recovery-credential-transition",
        label: "recovery credential-transition",
        case_count: || canonical_recovery_credential_transition_vector_corpus_v1().case_count(),
        bytes: canonical_recovery_credential_transition_vector_corpus_json_bytes_v1,
        check: |encoded| {
            Ok(
                parse_canonical_recovery_credential_transition_vector_corpus_json_v1(encoded)?
                    .case_count(),
            )
        },
    },
];

/// Corpora this binary encodes as pretty JSON itself, after the plain `emit`/`check` pair; the
/// usage text lists them first.
const PRETTY_CORPORA: [&str; 4] = [
    "kdf",
    "ceremony-context",
    "lifecycle-continuity",
    "provenance",
];

fn main() {
    if let Err(error) = run() {
        eprintln!("ed25519-yao-vectors: {error}");
        std::process::exit(1);
    }
}

fn run() -> CliResult<()> {
    let arguments: Vec<_> = env::args().skip(1).collect();
    match arguments.as_slice() {
        [action, flag, path] => run_file_command(action, flag, Path::new(path)),
        [action, seed_flag, seed, cases_flag, cases, output_flag, output]
            if action == "emit-differential"
                && seed_flag == "--seed-hex"
                && cases_flag == "--cases"
                && output_flag == "--output" =>
        {
            let corpus = differential_vector_corpus_v1(decode_hex_32(seed)?, cases.parse()?)?;
            emit_pretty(
                Path::new(output),
                &corpus,
                corpus.cases.len(),
                "deterministic differential",
            )
        }
        _ => Err(usage_error()),
    }
}

fn run_file_command(action: &str, flag: &str, path: &Path) -> CliResult<()> {
    match (action, flag) {
        ("emit", "--output") => {
            let corpus = canonical_vector_corpus_v1();
            emit_pretty(path, &corpus, corpus.cases.len(), "canonical")
        }
        ("check", "--input") => check_pretty::<VectorCorpusV1>(
            path,
            canonical_vector_corpus_v1,
            |corpus| corpus.cases.len(),
            "vector",
            "canonical",
        ),
        ("emit-kdf", "--output") => {
            let corpus = canonical_kdf_vector_corpus_v1();
            emit_pretty(path, &corpus, corpus.cases.len(), "KDF-continuity")
        }
        ("check-kdf", "--input") => check_pretty::<KdfVectorCorpusV1>(
            path,
            canonical_kdf_vector_corpus_v1,
            |corpus| corpus.cases.len(),
            "KDF-continuity",
            "KDF-continuity",
        ),
        ("emit-ceremony-context", "--output") => {
            let corpus = canonical_ceremony_context_vector_corpus_v1();
            emit_pretty(path, &corpus, corpus.cases.len(), "ceremony-context")
        }
        ("check-ceremony-context", "--input") => check_pretty::<CeremonyContextVectorCorpusV1>(
            path,
            canonical_ceremony_context_vector_corpus_v1,
            |corpus| corpus.cases.len(),
            "ceremony-context",
            "ceremony-context",
        ),
        ("emit-lifecycle-continuity", "--output") => {
            let corpus = canonical_lifecycle_continuity_corpus_v1();
            emit_pretty(path, &corpus, corpus.cases.len(), "lifecycle-continuity")
        }
        ("check-lifecycle-continuity", "--input") => check_lifecycle_continuity(path),
        ("emit-provenance", "--output") => {
            let corpus = canonical_provenance_vector_corpus_v1();
            emit_pretty(
                path,
                &corpus,
                corpus.cases.len(),
                "provenance outer-contract",
            )
        }
        ("check-provenance", "--input") => check_pretty::<ProvenanceVectorCorpusV1>(
            path,
            canonical_provenance_vector_corpus_v1,
            |corpus| corpus.cases.len(),
            "provenance outer-contract",
            "provenance outer-contract",
        ),
        _ => run_canonical_command(action, flag, path),
    }
}

fn run_canonical_command(action: &str, flag: &str, path: &Path) -> CliResult<()> {
    let named = |prefix| {
        let name = action.strip_prefix(prefix)?;
        CANONICAL_CORPORA.iter().find(|corpus| corpus.name == name)
    };
    match (flag, named("emit-"), named("check-")) {
        ("--output", Some(corpus), _) => {
            let cases = (corpus.case_count)();
            write_bytes(path, &(corpus.bytes)())?;
            println!("wrote {cases} {} cases to {}", corpus.label, path.display());
            Ok(())
        }
        ("--input", _, Some(corpus)) => {
            let cases = (corpus.check)(&fs::read(path)?)?;
            println!(
                "checked {cases} {} cases in {}",
                corpus.label,
                path.display()
            );
            Ok(())
        }
        _ => Err(usage_error()),
    }
}

fn usage_error() -> Box<dyn std::error::Error> {
    let names: Vec<_> = PRETTY_CORPORA
        .into_iter()
        .chain(CANONICAL_CORPORA.iter().map(|corpus| corpus.name))
        .collect();
    let emits: String = names
        .iter()
        .map(|name| format!(" | emit-{name} --output <path>"))
        .collect();
    let checks: String = names
        .iter()
        .map(|name| format!(" | check-{name} --input <path>"))
        .collect();
    format!(
        "usage: ed25519-yao-vectors emit --output <path> | emit-differential --seed-hex <64-hex-chars> --cases <count> --output <path>{emits} | check --input <path>{checks}"
    )
    .into()
}

fn emit_pretty<T: Serialize>(
    output: &Path,
    corpus: &T,
    cases: usize,
    label: &str,
) -> CliResult<()> {
    write_bytes(output, &pretty_json(corpus)?)?;
    println!("wrote {cases} {label} cases to {}", output.display());
    Ok(())
}

fn check_pretty<T: Serialize + DeserializeOwned + PartialEq>(
    input: &Path,
    canonical: fn() -> T,
    case_count: fn(&T) -> usize,
    corpus_label: &str,
    case_label: &str,
) -> CliResult<()> {
    let encoded = fs::read_to_string(input)?;
    let parsed: T = serde_json::from_str(&encoded)?;
    let expected = canonical();
    if parsed != expected {
        return Err(format!("{corpus_label} corpus drifted: {}", input.display()).into());
    }
    if encoded.as_bytes() != pretty_json(&expected)? {
        return Err(format!(
            "{corpus_label} corpus encoding is noncanonical: {}",
            input.display()
        )
        .into());
    }
    println!(
        "checked {} {case_label} cases in {}",
        case_count(&parsed),
        input.display()
    );
    Ok(())
}

fn check_lifecycle_continuity(input: &Path) -> CliResult<()> {
    let encoded = fs::read_to_string(input)?;
    let parsed: LifecycleContinuityCorpusV1 = serde_json::from_str(&encoded)?;
    parsed.validate()?;
    if encoded.as_bytes() != pretty_json(&canonical_lifecycle_continuity_corpus_v1())? {
        return Err(format!(
            "lifecycle-continuity corpus encoding is noncanonical: {}",
            input.display()
        )
        .into());
    }
    println!(
        "checked {} lifecycle-continuity cases in {}",
        parsed.cases.len(),
        input.display()
    );
    Ok(())
}

fn pretty_json<T: Serialize>(corpus: &T) -> CliResult<Vec<u8>> {
    let mut encoded = serde_json::to_vec_pretty(corpus)?;
    encoded.push(b'\n');
    Ok(encoded)
}

fn write_bytes(output: &Path, encoded: &[u8]) -> CliResult<()> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, encoded)?;
    Ok(())
}

fn decode_hex_32(value: &str) -> CliResult<[u8; 32]> {
    if value.len() != 64 {
        return Err("public differential seed must contain exactly 64 hex characters".into());
    }

    let mut output = [0u8; 32];
    for (index, byte) in output.iter_mut().enumerate() {
        let offset = index * 2;
        *byte = u8::from_str_radix(&value[offset..offset + 2], 16)
            .map_err(|_| "public differential seed contains invalid hex")?;
    }
    Ok(output)
}
