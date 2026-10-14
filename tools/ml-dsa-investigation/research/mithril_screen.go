package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"runtime"
	"time"

	ordinary "github.com/cloudflare/circl/sign/mldsa/mldsa65"
	threshold "github.com/cloudflare/circl/sign/thmldsa/thmldsa65"
)

type Sample struct {
	Index          int           `json:"index"`
	Warmup         bool          `json:"warmup"`
	Attempts       int           `json:"attempts"`
	SignMS         float64       `json:"sign_ms"`
	RoundMS        [2][3]float64 `json:"round_ms"`
	CombineMS      [2]float64    `json:"combine_ms"`
	SentBytes      [2][3]int     `json:"sent_bytes_by_party_round"`
	TotalBytes     int           `json:"total_protocol_bytes"`
	MessageHex     string        `json:"message_hex"`
	SignatureHex   string        `json:"signature_hex"`
	Verified       bool          `json:"library_verified"`
	ReplayRejected bool          `json:"round_state_replay_rejected"`
}

func millis(start time.Time) float64 {
	return float64(time.Since(start).Nanoseconds()) / 1e6
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}

func signSample(index int, pk *threshold.PublicKey, shares []threshold.PrivateKey, params *threshold.ThresholdParams) Sample {
	var number [8]byte
	binary.LittleEndian.PutUint64(number[:], uint64(index))
	message := sha256.Sum256(append([]byte("seams/ml-dsa/specialized-screen/v1"), number[:]...))
	sample := Sample{Index: index, Warmup: index == 0, MessageHex: hex.EncodeToString(message[:])}
	started := time.Now()
	for attempt := 1; attempt <= 100; attempt++ {
		firstStates := make([]threshold.StRound1, 2)
		secondStates := make([]threshold.StRound2, 2)
		first := make([][]byte, 2)
		second := make([][]byte, 2)
		third := make([][]byte, 2)
		for party := 0; party < 2; party++ {
			stage := time.Now()
			var err error
			first[party], firstStates[party], err = threshold.Round1(&shares[party], params)
			check(err)
			sample.RoundMS[party][0] += millis(stage)
			sample.SentBytes[party][0] += len(first[party])
		}
		for party := 0; party < 2; party++ {
			stage := time.Now()
			var err error
			second[party], secondStates[party], err = threshold.Round2(&shares[party], 3, message[:], nil, first, &firstStates[party], params)
			check(err)
			sample.RoundMS[party][1] += millis(stage)
			sample.SentBytes[party][1] += len(second[party])
		}
		for party := 0; party < 2; party++ {
			stage := time.Now()
			var err error
			third[party], err = threshold.Round3(&shares[party], second, &secondStates[party], params)
			check(err)
			sample.RoundMS[party][2] += millis(stage)
			sample.SentBytes[party][2] += len(third[party])
		}
		signatures := [2][]byte{make([]byte, threshold.SignatureSize), make([]byte, threshold.SignatureSize)}
		var accepted [2]bool
		for party := 0; party < 2; party++ {
			stage := time.Now()
			accepted[party] = threshold.Combine(pk, message[:], nil, second, third, signatures[party], params)
			sample.CombineMS[party] += millis(stage)
		}
		if accepted[0] != accepted[1] {
			panic("combination decisions differ")
		}
		if !accepted[0] {
			continue
		}
		if !bytes.Equal(signatures[0], signatures[1]) {
			panic("combined signatures differ")
		}
		sample.SignMS = millis(started)
		sample.Attempts = attempt
		sample.SignatureHex = hex.EncodeToString(signatures[0])
		sample.Verified = threshold.Verify(pk, message[:], nil, signatures[0])
		if !sample.Verified {
			panic("signature verification failed")
		}
		sample.ReplayRejected = true
		for party := 0; party < 2; party++ {
			_, _, err := threshold.Round2(&shares[party], 3, message[:], nil, first, &firstStates[party], params)
			sample.ReplayRejected = sample.ReplayRejected && errors.Is(err, threshold.ErrStateAlreadyUsed)
			_, err = threshold.Round3(&shares[party], second, &secondStates[party], params)
			sample.ReplayRejected = sample.ReplayRejected && errors.Is(err, threshold.ErrStateAlreadyUsed)
			for round := 0; round < 3; round++ {
				sample.TotalBytes += sample.SentBytes[party][round]
			}
		}
		if !sample.ReplayRejected {
			panic("consumed state accepted a second use")
		}
		return sample
	}
	panic("signature attempt limit reached")
}

func main() {
	if len(os.Args) != 2 {
		panic("provide an output JSON path")
	}
	params, err := threshold.GetThresholdParams(2, 2)
	check(err)
	var seed [32]byte
	started := time.Now()
	pk, shares := threshold.NewThresholdKeysFromSeed(&seed, params)
	keygenMS := millis(started)
	reference, _ := ordinary.NewKeyFromSeed(&seed)
	samples := make([]Sample, 0, 101)
	for index := 0; index < 101; index++ {
		samples = append(samples, signSample(index, pk, shares, params))
	}
	result := map[string]any{
		"schema":              "seams.ml-dsa-specialized-native-screen.v1",
		"source_repository":   "https://github.com/Threshold-ML-DSA/Threshold-ML-DSA",
		"source_commit":       "66e269e75dd8f5d722675a3d276a1aedc58bc4ef",
		"production_eligible": false,
		"go_version":          runtime.Version(), "goos": runtime.GOOS, "goarch": runtime.GOARCH,
		"threshold": 2, "parties": 2, "parallel_candidates_per_attempt": params.K,
		"public_fixture_seed_hex":                       hex.EncodeToString(seed[:]),
		"public_key_hex":                                hex.EncodeToString(pk.Bytes()),
		"ordinary_seed_public_key_hex":                  hex.EncodeToString(reference.Bytes()),
		"direct_seed_path_preserves_canonical_fips_key": bytes.Equal(pk.Bytes(), reference.Bytes()),
		"keygen_ms": keygenMS,
		"samples":   samples,
		"scope":     "One native process simulates two logical roles sequentially. All signing rounds, both combinations, retries, and actual message lengths are included. Verification and replay checks follow the timer. No network, Worker, secret import, or party-isolation claim.",
	}
	encoded, err := json.MarshalIndent(result, "", "  ")
	check(err)
	check(os.WriteFile(os.Args[1], append(encoded, '\n'), 0600))
	fmt.Println("Wrote101 complete protocol screens; canonical identity match:", result["direct_seed_path_preserves_canonical_fips_key"])
}
