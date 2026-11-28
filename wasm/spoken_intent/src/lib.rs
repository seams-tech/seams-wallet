//! The transcript reader of `spoken-intent` for a SaySo verdict. SaySo signs the transcript of a
//! recording and does not decide its words. Wallet core and the Seams co-signer read the
//! transcript with `normalize_punctuated`, the rules that the OutLayer verifier ran in its TEE,
//! and compare the words with the spoken words of the request.

use spoken_intent::{normalize_punctuated, spoken_text, PunctuatedRefusal, SpokenAccount};
use wasm_bindgen::prelude::*;

/// The spoken words of `transcript`, joined with single spaces. `contacts` are the accounts that
/// a recipient may match by sound: the receiver of the request, or none.
///
/// Throws a code: `contact_not_speakable`, `not_normalizable`, `recipient_unkeyable`,
/// `recipient_not_contact` or `recipient_ambiguous`.
#[wasm_bindgen]
pub fn heard_words(transcript: &str, contacts: Vec<String>) -> Result<String, JsValue> {
    read(transcript, &contacts).map_err(|code| JsValue::from_str(code))
}

fn read(transcript: &str, contacts: &[String]) -> Result<String, &'static str> {
    let accounts = contacts
        .iter()
        .map(|id| SpokenAccount::new(id).map_err(|_| "contact_not_speakable"))
        .collect::<Result<Vec<_>, _>>()?;
    let tokens = normalize_punctuated(transcript, &accounts).map_err(|refusal| match refusal {
        PunctuatedRefusal::NotNormalizable => "not_normalizable",
        PunctuatedRefusal::RecipientUnkeyable => "recipient_unkeyable",
        PunctuatedRefusal::RecipientNotContact => "recipient_not_contact",
        PunctuatedRefusal::RecipientAmbiguous => "recipient_ambiguous",
    })?;
    Ok(spoken_text(&tokens))
}

#[cfg(test)]
mod tests {
    use super::read;

    #[test]
    fn a_whisper_transcript_reads_as_the_spoken_words() {
        let contacts = ["bob-1.testnet".to_string()];
        assert_eq!(
            read("Send 2.5 NEAR to bob-1.testnet.", &contacts),
            Ok("send two point five near to bob dash one dot testnet".to_string()),
        );
    }

    #[test]
    fn a_recipient_that_is_no_contact_is_refused() {
        let contacts = ["alice.testnet".to_string()];
        assert_eq!(read("Send 10 NEAR to mallory.testnet.", &contacts), Err("recipient_not_contact"));
        assert_eq!(read("Send 10 NEAR to bob.testnet.", &[]), Err("recipient_not_contact"));
        assert_eq!(read("Send 10 NEAR to bob.testnet.", &["0x12".to_string()]), Err("contact_not_speakable"));
    }

    #[test]
    fn a_sentence_with_no_recipient_keeps_its_words() {
        assert_eq!(read("This note is helpful.", &[]), Ok("this note is helpful".to_string()));
    }
}
