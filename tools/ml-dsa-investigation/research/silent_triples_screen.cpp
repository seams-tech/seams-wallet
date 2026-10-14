#include "libOTe/Triple/SilentOtTriple/SilentOtTriple.h"
#include "coproto/Socket/LocalAsyncSock.h"
#include "macoro/sync_wait.h"
#include "macoro/when_all.h"
#include <array>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <sys/resource.h>
#include <vector>

#ifdef ENABLE_MOCK_OT
#error This benchmark requires real base OT.
#endif

using namespace osuCrypto;
using Clock = std::chrono::steady_clock;

static double elapsed_ms(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

static std::uint64_t peak_bytes() {
    rusage usage{};
    if (getrusage(RUSAGE_SELF, &usage) != 0) throw std::runtime_error("getrusage failed");
#ifdef __APPLE__
    return usage.ru_maxrss;
#else
    return std::uint64_t(usage.ru_maxrss) * 1024;
#endif
}

static void complete(macoro::task<> first, macoro::task<> second) {
    auto tasks = macoro::sync_wait(macoro::when_all_ready(std::move(first), std::move(second)));
    std::get<0>(tasks).result();
    std::get<1>(tasks).result();
}

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("Provide a triple count");
        const auto requested = std::stoull(argv[1]);
        if (requested == 0 || requested > 1048576) throw std::runtime_error("Count exceeds this memory screen");
        const auto blocks = (requested + 127) / 128;
        auto sockets = coproto::LocalAsyncSocket::makePair();
        PRNG random0(sysRandomSeed());
        PRNG random1(sysRandomSeed());
        std::array<SilentOtTriple, 2> parties;
        const auto started = Clock::now();
        for (std::size_t role = 0; role < 2; ++role) {
            parties[role].mLpnMultType = MultType::ExConv7x24;
            parties[role].init(role, requested, SilentSecType::SemiHonest, SilentOtTriple::Type::Triple);
        }
        // This pinned wrapper initializes its inner engine with the library default.
        // Select the measured profile before sampling any base correlations.
        auto& receiver = std::get<1>(parties[0].mSendRecv);
        auto& sender = std::get<0>(parties[1].mSendRecv);
        receiver.configure(parties[0].mN, 2, 1, SilentSecType::SemiHonest,
                           SdNoiseDistribution::Regular, MultType::ExConv7x24);
        sender.configure(parties[1].mN, 2, 1, SilentSecType::SemiHonest,
                         SdNoiseDistribution::Regular, MultType::ExConv7x24);
        if (receiver.mLpnMultType != MultType::ExConv7x24 ||
            sender.mLpnMultType != MultType::ExConv7x24 ||
            receiver.mNumPartitions != sender.mNumPartitions ||
            receiver.mSizePer != sender.mSizePer ||
            receiver.mNoiseVecSize != sender.mNoiseVecSize)
            throw std::runtime_error("Silent OT profile differs between roles");
        const auto partitions = sender.mNumPartitions;
        const auto partition_size = sender.mSizePer;
        const auto sparse_size = sender.mNoiseVecSize;
        const auto base_started = Clock::now();
        complete(parties[0].genBaseOts(random0, sockets[0]), parties[1].genBaseOts(random1, sockets[1]));
        const auto base_ms = elapsed_ms(base_started);
        const auto base_sent0 = sockets[0].bytesSent();
        const auto base_sent1 = sockets[1].bytesSent();
        if (!parties[0].hasBaseOts() || !parties[1].hasBaseOts() || base_sent0 == 0 || base_sent1 == 0)
            throw std::runtime_error("Fresh base OT did not complete");
        std::array<std::vector<block>, 2> a, b, c;
        for (std::size_t role = 0; role < 2; ++role) {
            a[role].resize(blocks);
            b[role].resize(blocks);
            c[role].resize(blocks);
        }
        const auto expansion_started = Clock::now();
        complete(parties[0].expand(a[0], b[0], c[0], random0, sockets[0]),
                 parties[1].expand(a[1], b[1], c[1], random1, sockets[1]));
        const auto expansion_ms = elapsed_ms(expansion_started);
        const auto total_ms = elapsed_ms(started);
        const auto protocol_peak = peak_bytes();
        if (sockets[0].bytesSent() != sockets[1].bytesReceived() ||
            sockets[1].bytesSent() != sockets[0].bytesReceived())
            throw std::runtime_error("Directional traffic differs");
        for (std::size_t index = 0; index < blocks; ++index) {
            const auto clear_product = (a[0][index] ^ a[1][index]) & (b[0][index] ^ b[1][index]);
            if (clear_product != (c[0][index] ^ c[1][index])) throw std::runtime_error("Triple invariant failed");
            const auto x0 = random0.get<block>();
            const auto y0 = random0.get<block>();
            const auto x1 = random1.get<block>();
            const auto y1 = random1.get<block>();
            const auto d = x0 ^ a[0][index] ^ x1 ^ a[1][index];
            const auto e = y0 ^ b[0][index] ^ y1 ^ b[1][index];
            const auto z0 = c[0][index] ^ (d & b[0][index]) ^ (e & a[0][index]) ^ (d & e);
            const auto z1 = c[1][index] ^ (d & b[1][index]) ^ (e & a[1][index]);
            if ((z0 ^ z1) != ((x0 ^ x1) & (y0 ^ y1))) throw std::runtime_error("Shared AND failed");
        }
        std::cout << "{\"requested_triples\":" << requested
                  << ",\"generated_triples\":" << blocks * 128
                  << ",\"fresh_base_ot\":true,\"mult_type\":\"ExConv7x24\""
                  << ",\"profile_selected_before_base_ot\":true,\"security_parameter_bits\":128"
                  << ",\"noise_distribution\":\"regular\",\"partitions\":" << partitions
                  << ",\"partition_size\":" << partition_size << ",\"sparse_vector_size\":" << sparse_size
                  << ",\"base_ms\":" << base_ms << ",\"expansion_ms\":" << expansion_ms
                  << ",\"total_ms\":" << total_ms
                  << ",\"base_sent_bytes\":[" << base_sent0 << "," << base_sent1 << "]"
                  << ",\"total_sent_bytes\":[" << sockets[0].bytesSent() << "," << sockets[1].bytesSent() << "]"
                  << ",\"two_role_process_peak_rss_bytes\":" << protocol_peak
                  << ",\"triple_invariant_verified\":true,\"shared_and_verified\":true}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n";
        return 1;
    }
}
