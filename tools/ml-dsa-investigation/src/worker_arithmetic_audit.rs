//! Inspect private arithmetic in the exact Wasm files packaged by worker-build.

use crate::{InvestigationResult, command_text, digest, require};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::Path, process::Command};
use wasmparser::{FuncType, FunctionBody, KnownCustom, Name, Operator, Parser, Payload, TypeRef};

const PRIVATE_FUNCTIONS: [&str; 3] = ["inverse_ntt", "matrix_product_plus_error", "ntt"];

pub(super) fn build_and_inspect(repository: &Path) -> InvestigationResult<Value> {
    let directory = repository.join("crates/ed25519-yao-cloudflare-bench");
    let builder = command_text(Command::new("worker-build").arg("--version"))?;
    let mut roles = Vec::new();
    for role in ["a", "b"] {
        println!("Build and inspect final ML-DSA Worker {role} arithmetic.");
        let output = format!("build/ml-dsa-{role}");
        let feature = format!("ml-dsa-{role}");
        let build = Command::new("worker-build")
            .current_dir(&directory)
            .args(["--release", "--out-dir", &output, "--features", &feature])
            .output()?;
        require(
            build.status.success(),
            &format!(
                "Worker {role} build failed:\n{}\n{}",
                String::from_utf8_lossy(&build.stdout),
                String::from_utf8_lossy(&build.stderr)
            ),
        )?;
        let wasm_path = directory.join(&output).join("index_bg.wasm");
        let script_path = directory.join(&output).join("index.js");
        let bytes = fs::read(&wasm_path)?;
        roles.push(json!({
            "role": role,
            "build_argv": ["worker-build", "--release", "--out-dir", output, "--features", feature],
            "wasm_path": wasm_path.strip_prefix(repository)?,
            "wasm_bytes": bytes.len(),
            "wasm_sha256": digest(&bytes),
            "script_sha256": digest(&fs::read(script_path)?),
            "private_functions": inspect(&bytes, Subject::Arithmetic)?,
        }));
    }
    Ok(json!({
        "worker_build_version": builder,
        "audit_source_sha256": digest(&fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/worker_arithmetic_audit.rs"))?),
        "worker_manifest_sha256": digest(&fs::read(directory.join("Cargo.toml"))?),
        "worker_lockfile_sha256": digest(&fs::read(directory.join("Cargo.lock"))?),
        "roles": roles,
        "scope": "Final packaged Wasm function bodies, including inlined instructions. Complete instruction streams, local declarations, calls, and conditional control flow are recorded for manual data-flow review.",
    }))
}

#[derive(Clone, Copy)]
enum Subject {
    Arithmetic,
    SilentCorrelations,
}

pub(super) fn inspect_silent(output: &Path) -> InvestigationResult<()> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .ok_or("Missing repository")?;
    let mut roles = Vec::new();
    for role in ["a", "b"] {
        let path = format!("crates/ed25519-yao-cloudflare-bench/build/ml-dsa-{role}/index_bg.wasm");
        let bytes = fs::read(root.join(&path))?;
        roles.push(json!({"role":role, "path":path, "wasm_sha256":digest(&bytes), "functions":inspect(&bytes, Subject::SilentCorrelations)?}));
    }
    fs::write(
        output,
        serde_json::to_vec_pretty(&json!({
            "schema":"seams.ml-dsa-silent-wasm-instructions.v1", "production_eligible":false, "roles":roles,
            "scope":"Instruction inventory of final packaged silent-correlation, public encoder, portable AES functions, and immediate callers containing inlined PPRF code. Branches and addresses need manual secret-data-flow review. This inventory alone does not prove constant-time execution."
        }))?,
    )?;
    Ok(())
}

fn inspect(bytes: &[u8], subject: Subject) -> InvestigationResult<Vec<Value>> {
    let mut types = Vec::new();
    let mut function_types = Vec::new();
    let mut names = BTreeMap::new();
    let mut bodies = BTreeMap::new();
    let mut function_index = 0;
    for payload in Parser::new(0).parse_all(bytes) {
        match payload? {
            Payload::TypeSection(section) => {
                for kind in section.into_iter_err_on_gc_types() {
                    types.push(kind?);
                }
            }
            Payload::FunctionSection(section) => {
                for kind in section {
                    function_types.push(kind?);
                }
            }
            Payload::ImportSection(imports) => {
                for import in imports {
                    if let TypeRef::Func(kind) = import?.ty {
                        function_types.push(kind);
                        function_index += 1;
                    }
                }
            }
            Payload::CodeSectionEntry(body) => {
                bodies.insert(function_index, body);
                function_index += 1;
            }
            Payload::CustomSection(section) => {
                if let KnownCustom::Name(reader) = section.as_known() {
                    for subsection in reader {
                        if let Name::Function(functions) = subsection? {
                            for function in functions {
                                let function = function?;
                                require(
                                    names.insert(function.index, function.name).is_none(),
                                    "Duplicate Wasm function name entry.",
                                )?;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let mut selected = Vec::new();
    match subject {
        Subject::Arithmetic => {
            for name in PRIVATE_FUNCTIONS {
                let suffix = format!("::passive::ml_dsa_signing::arithmetic::{name}");
                let mut matches = Vec::new();
                for (index, symbol) in &names {
                    if symbol.starts_with("ed25519_yao[") && symbol.ends_with(&suffix) {
                        matches.push((*index, *symbol));
                    }
                }
                require(
                    matches.len() == 1,
                    &format!("Expected one final Worker function for {name}"),
                )?;
                selected.push((name, matches[0].0, matches[0].1));
            }
        }
        Subject::SilentCorrelations => {
            for (index, symbol) in &names {
                if (symbol.starts_with("ed25519_yao[")
                    && symbol.contains("::boolean_comparison::silent::"))
                    || symbol.starts_with("cryprot_codes[")
                    || (symbol.starts_with("aes[") && symbol.contains("::soft::fixslice::"))
                    || symbol.contains("::gate_aes::sub_bytes")
                    || symbol.contains("::gate_aes::bitslice")
                {
                    selected.push((*symbol, *index, *symbol));
                }
            }
            let mut primitive_indices = Vec::new();
            for (_, index, symbol) in &selected {
                if symbol.contains("::silent::pprf::expand_level")
                    || symbol.contains("::silent::hash")
                {
                    primitive_indices.push(*index);
                }
            }
            // Async PPRF recovery and compression can inline into their caller.
            // Retain those containing bodies for manual data-flow inspection.
            for (index, body) in &bodies {
                let mut reader = body.get_operators_reader()?;
                let mut calls_primitive = false;
                while !reader.eof() {
                    if let Operator::Call { function_index } = reader.read()? {
                        calls_primitive |= primitive_indices.contains(&function_index);
                    }
                }
                if calls_primitive && !selected.iter().any(|entry| entry.1 == *index) {
                    let symbol = names.get(index).copied().ok_or("Unnamed silent caller")?;
                    selected.push((symbol, *index, symbol));
                }
            }
            require(
                !selected.is_empty(),
                "Silent functions missing from final Wasm",
            )?;
        }
    }
    let mut functions = Vec::new();
    for (name, index, symbol) in selected {
        let body = bodies
            .get(&index)
            .ok_or("Selected function has no Wasm body")?;
        let signature = &types[function_types[index as usize] as usize];
        functions.push(inspect_body(
            bytes, body, index, name, symbol, &names, signature, subject,
        )?);
    }
    Ok(functions)
}

fn inspect_body(
    bytes: &[u8],
    body: &FunctionBody<'_>,
    index: u32,
    name: &str,
    symbol: &str,
    names: &BTreeMap<u32, &str>,
    signature: &FuncType,
    subject: Subject,
) -> InvestigationResult<Value> {
    let range = body.range();
    let mut operators = body.get_operators_reader()?;
    let mut divisions = Vec::new();
    let mut branches = Vec::new();
    let mut selections = Vec::new();
    let mut calls = Vec::new();
    let mut indirect_calls = Vec::new();
    let mut instructions = Vec::new();
    let locals = body
        .get_locals_reader()?
        .into_iter()
        .map(|entry| {
            entry.map(|(count, kind)| json!({"count": count, "type": format!("{kind:?}")}))
        })
        .collect::<Result<Vec<_>, _>>()?;
    while !operators.eof() {
        let offset = operators.original_position();
        let operator = operators.read()?;
        let site = json!({"wasm_offset": offset, "operator": format!("{operator:?}")});
        instructions.push(site.clone());
        match operator {
            Operator::I32DivS
            | Operator::I32DivU
            | Operator::I64DivS
            | Operator::I64DivU
            | Operator::I32RemS
            | Operator::I32RemU
            | Operator::I64RemS
            | Operator::I64RemU => {
                divisions.push(site);
            }
            Operator::If { .. } | Operator::BrIf { .. } | Operator::BrTable { .. } => {
                branches.push(site);
            }
            Operator::Select | Operator::TypedSelect { .. } => {
                selections.push(site);
            }
            Operator::Call { function_index } | Operator::ReturnCall { function_index } => {
                calls.push(json!({
                    "wasm_offset": offset,
                    "function_index": function_index,
                    "symbol": names.get(&function_index),
                }));
            }
            Operator::CallIndirect { .. }
            | Operator::ReturnCallIndirect { .. }
            | Operator::CallRef { .. }
            | Operator::ReturnCallRef { .. } => match subject {
                Subject::Arithmetic => {
                    return Err(
                        format!("Unresolved indirect call in private arithmetic {name}.").into(),
                    );
                }
                Subject::SilentCorrelations => indirect_calls.push(site),
            },
            _ => {}
        }
    }
    if matches!(subject, Subject::Arithmetic) {
        require(
            divisions.is_empty(),
            &format!("Division or remainder remains in final Worker {name}: {divisions:?}"),
        )?;
    }
    Ok(json!({
        "function": name,
        "symbol": symbol,
        "function_index": index,
        "body_range": {"start": range.start, "end": range.end},
        "body_sha256": digest(&bytes[range]),
        "operator_count": instructions.len(),
        "parameter_types": signature.params().iter().map(|kind| format!("{kind:?}")).collect::<Vec<_>>(),
        "result_types": signature.results().iter().map(|kind| format!("{kind:?}")).collect::<Vec<_>>(),
        "locals": locals,
        "instructions": instructions,
        "division_or_remainder_sites": divisions,
        "conditional_branch_sites_requiring_review": branches,
        "direct_calls_requiring_review": calls,
        "indirect_calls_requiring_review": indirect_calls,
        "value_selection_sites_requiring_target_review": selections,
    }))
}
