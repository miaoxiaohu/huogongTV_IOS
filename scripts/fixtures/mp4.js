/**
 * Builds synthetic CENC MP4 files for the tests.
 *
 * The real episode files only ever use one shape: `stco` chunk offsets, a
 * 32 bit `saio` offset and a per sample IV of exactly 8 bytes. Everything
 * else in the CENC specification - 64 bit chunk offsets, a 64 bit auxiliary
 * offset, and sub sample encryption where only part of a sample is
 * encrypted - never shows up in the wild on these files, so it never showed
 * up in the tests either.
 *
 * These fixtures close that gap. The encryption is done with node:crypto, so
 * the expected plaintext is produced by an independent implementation and the
 * code under test has to agree with it byte for byte.
 */
const crypto = require("crypto");

/** Big-endian helpers. */
function u16(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v >>> 0);
    return b;
}
function u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v >>> 0);
    return b;
}
function u64(v) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(v));
    return b;
}

/** version and flags are separate fields: one byte version, three bytes flags. */
function versionFlags(version, flags) {
    return Buffer.from([version & 0xff, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]);
}

/** A box with a 32 bit size field. */
function box(type, ...parts) {
    const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
    return Buffer.concat([u32(body.length + 8), Buffer.from(type, "latin1"), body]);
}

/** A 16 byte counter block: 8 byte IV followed by 8 zero bytes. */
function counterBlock(iv) {
    const b = Buffer.alloc(16);
    Buffer.from(iv).copy(b, 0);
    return b;
}

/**
 * Encrypts one sample the way CENC does: the whole encrypted region of the
 * sample is one continuous AES-CTR stream, so the counter keeps running
 * across the sub samples.
 */
function encryptSample(key, iv, regions) {
    const stream = Buffer.concat(regions.map((r) => r.encrypted));
    const cipher = crypto.createCipheriv("aes-128-ctr", Buffer.from(key), counterBlock(iv));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(stream), cipher.final()]);
    const out = [];
    let at = 0;
    for (const region of regions) {
        out.push(Buffer.from(region.clear));
        out.push(encrypted.subarray(at, at + region.encrypted.length));
        at += region.encrypted.length;
    }
    return Buffer.concat(out);
}

/**
 * Builds a CENC encrypted MP4.
 *
 * options:
 *   key         16 byte content key
 *   samples     array of { plain: Buffer, regions?: [{clear, encrypted}] }
 *               `regions` describes a sub sample layout; without it the whole
 *               sample is encrypted.
 *   ivs         one 8 byte IV per sample
 *   useCo64     write 64 bit chunk offsets instead of 32 bit ones
 *   saioVersion 0 for a 32 bit auxiliary offset, 1 for a 64 bit one
 *   trackCount  how many tracks to emit (each with its own sample table)
 */
function buildCencMp4(options) {
    const key = Buffer.from(options.key);
    const ivs = options.ivs;
    const useCo64 = !!options.useCo64;
    const saioVersion = options.saioVersion || 0;
    const trackCount = options.trackCount || 1;

    // The media data, encrypted, plus the sample table entries.
    const tracks = [];
    for (let t = 0; t < trackCount; t++) {
        const samples = options.samples.filter((_, i) => i % trackCount === t);
        const ivList = ivs.filter((_, i) => i % trackCount === t);
        const encrypted = samples.map((sample, i) => {
            if (sample.regions) {
                return encryptSample(key, ivList[i], sample.regions);
            }
            return encryptSample(key, ivList[i], [{ clear: Buffer.alloc(0), encrypted: sample.plain }]);
        });
        tracks.push({ samples, ivList, encrypted });
    }

    // The auxiliary information: per sample IV, and for sub sample samples
    // the sub sample table as well. Each track gets its own slice, so the
    // aux offsets have to be computed per track.
    const trackAuxEntries = [];
    for (const track of tracks) {
        const entries = [];
        for (let i = 0; i < track.samples.length; i++) {
            const sample = track.samples[i];
            if (sample.regions) {
                const parts = [Buffer.from(track.ivList[i]), u16(sample.regions.length)];
                for (const region of sample.regions) {
                    parts.push(u16(region.clear.length), u32(region.encrypted.length));
                }
                entries.push(Buffer.concat(parts));
            } else {
                entries.push(Buffer.from(track.ivList[i]));
            }
        }
        trackAuxEntries.push(entries);
    }
    const auxData = Buffer.concat(trackAuxEntries.flat());
    // The byte offset of each track's slice inside the blob.
    const auxTrackOffsets = [];
    {
        let at = 0;
        for (const entries of trackAuxEntries) {
            auxTrackOffsets.push(at);
            at += entries.reduce((sum, e) => sum + e.length, 0);
        }
    }

    // The sample table of one track, with placeholder offsets.
    function buildStbl(track, sampleOffsets, auxOffset) {
        const sizes = track.encrypted.map((e) => e.length);
        const count = sizes.length;
        const stsd = box(
            "stsd",
            u32(0),
            u32(1),
            box(
                "encv",
                Buffer.alloc(6), // reserved
                u16(1), // data reference index
                u16(0), // pre defined
                u16(0), // reserved
                u32(0),
                u32(0),
                u32(0), // pre defined
                u16(1080),
                u16(1920),
                u32(0x00480000),
                u32(0x00480000),
                u32(0), // reserved
                u16(1), // frame count
                Buffer.alloc(32), // compressor name
                u16(0x0018), // depth
                u16(0xffff), // pre defined
                box("hvcC", Buffer.from([1, 1, 0x60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x01, 0, 0x01, 0, 0x05, 0x01, 0, 0, 0, 0x03])),
                box(
                    "sinf",
                    box("frma", Buffer.from("hvc1", "latin1")),
                    box("schm", u32(0), Buffer.from("cenc", "latin1"), u32(0x00010000)),
                    box(
                        "schi",
                        box(
                            "tenc",
                            u32(0),
                            Buffer.from([0x00, 0x01, 0x08]),
                            Buffer.alloc(16), // default KID
                            Buffer.from([0x00]) // no constant IV
                        )
                    )
                )
            )
        );
        const stts = box("stts", u32(0), u32(1), u32(count), u32(1000));
        const stsc = box("stsc", u32(0), u32(1), u32(1), u32(count), u32(1));
        const stsz = box("stsz", u32(0), u32(0), u32(count), ...sizes.map(u32));
        const chunkOffsets = useCo64 ? box("co64", u32(0), u32(1), ...sampleOffsets.map(u64)) : box("stco", u32(0), u32(1), ...sampleOffsets.map(u32));
        const subsampleSizes = track.samples.map((s) => (s.regions ? 10 + s.regions.length * 6 : 8));
        const allEight = subsampleSizes.every((s) => s === 8);
        const saiz = allEight
            ? box("saiz", versionFlags(0, 0), Buffer.from([8]), u32(count))
            : box("saiz", versionFlags(0, 0), Buffer.from([0]), u32(count), ...subsampleSizes.map((s) => Buffer.from([s])));
        const saio = box(
            "saio",
            versionFlags(saioVersion, 0),
            u32(1),
            saioVersion === 1 ? u64(auxOffset) : u32(auxOffset)
        );
        return box("stbl", stsd, stts, stsc, stsz, chunkOffsets, saiz, saio);
    }

    const matrix = Buffer.concat([
        u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
    ]);

    function buildTrak(track, sampleOffsets, auxOffset) {
        const tkhd = box(
            "tkhd",
            u32(0x00000007),
            u32(0),
            u32(0),
            u32(1),
            u32(0),
            u32(track.encrypted.length * 1000),
            u32(0),
            u32(0),
            u16(0),
            u16(0),
            u16(0),
            u16(0),
            matrix,
            u32(1080 << 16),
            u32(1920 << 16)
        );
        const mdhd = box("mdhd", u32(0), u32(0), u32(0), u32(1000), u32(track.encrypted.length * 1000), u16(0x55c4), u16(0));
        const hdlr = box("hdlr", u32(0), u32(0), Buffer.from("vide", "latin1"), u32(0), u32(0), u32(0), Buffer.from("v\0", "latin1"));
        const vmhd = box("vmhd", u32(1), u16(0), u16(0), u16(0), u16(0));
        const dinf = box("dinf", box("dref", u32(0), u32(1), box("url ", u32(1))));
        const stbl = buildStbl(track, sampleOffsets, auxOffset);
        const minf = box("minf", vmhd, dinf, stbl);
        const mdia = box("mdia", mdhd, hdlr, minf);
        return box("trak", tkhd, mdia);
    }

    // Two passes: the offsets are placeholders in the first one, and the
    // boxes are the same size in the second because every offset field has
    // a fixed width.
    function assemble(sampleOffsets, auxBase) {
        const ftyp = box("ftyp", Buffer.from("isom", "latin1"), u32(0), Buffer.from("isom", "latin1"), Buffer.from("iso2", "latin1"), Buffer.from("mp41", "latin1"));
        const mvhd = box(
            "mvhd",
            u32(0),
            u32(0),
            u32(0),
            u32(1000),
            u32(1000),
            u32(0x00010000),
            u16(0x0100),
            u16(0),
            u32(0),
            u32(0),
            matrix,
            u32(0),
            u32(0),
            u32(2)
        );
        const traks = tracks.map((track, i) =>
            buildTrak(track, sampleOffsets[i] || [], auxBase + auxTrackOffsets[i])
        );
        const auxBox = box("free", auxData);
        const moov = box("moov", mvhd, ...traks, auxBox);
        const mdat = box("mdat", ...tracks.flatMap((t) => t.encrypted));
        return { ftyp, moov, mdat, auxBox };
    }

    // The placeholder has to be exactly the same size as the final file,
    // otherwise every offset below is off. The number of chunk offsets is
    // known, only their values change.
    const placeholder = assemble(tracks.map((t) => new Array(t.encrypted.length).fill(0)), 0);
    const moovStart = placeholder.ftyp.length;
    const mdatStart = moovStart + placeholder.moov.length;
    // The auxiliary data sits inside the moov, in the trailing free box.
    const auxOffset = moovStart + placeholder.moov.length - placeholder.auxBox.length + 8;

    // The mdat holds the tracks one after the other, so the chunk offsets
    // have to run on across the tracks as well.
    const sampleOffsets = [];
    {
        let at = mdatStart + 8;
        for (const track of tracks) {
            const offsets = [];
            for (const e of track.encrypted) {
                offsets.push(at);
                at += e.length;
            }
            sampleOffsets.push(offsets);
        }
    }

    const final = assemble(sampleOffsets, auxOffset);
    const file = Buffer.concat([final.ftyp, final.moov, final.mdat]);
    return { file: new Uint8Array(file), auxOffset, mdatStart };
}

module.exports = { buildCencMp4, box, u16, u32, u64, counterBlock, encryptSample };
