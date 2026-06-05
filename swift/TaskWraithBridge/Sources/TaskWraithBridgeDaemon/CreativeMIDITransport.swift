import Foundation
import CoreMIDI

/// Phase K6 — Core MIDI transport. Creates a virtual MIDI source port
/// named "TaskWraith" that Logic Pro (and any other MIDI receiver) can
/// auto-discover and route as an input. Sends typed events
/// (transport, CC, Note On, Program Change) via `MIDIReceived` so
/// every connected receiver sees them.
///
/// Why a virtual source (not an output sent to a hardware port):
/// - Logic Pro's "Control Surfaces" pane lets the user map any MIDI
///   input to its global controls (transport, mixer, parameters).
///   Creating a virtual source named "TaskWraith" gives the user a
///   clearly-labeled target to route on the Logic side, without
///   TaskWraith needing to know which hardware ports are present.
/// - No driver, no permission prompts — Core MIDI's virtual-source
///   API is unrestricted on macOS for any app already running.
///
/// The MIDI client + source port are lazy-initialised on the first
/// dispatch call so the daemon doesn't pay the cost on cold start
/// when nobody's using K6.
enum CreativeMIDITransport {
    /// Lazy-initialised state. Holds the MIDIClientRef and
    /// MIDIEndpointRef for our virtual source. The daemon is
    /// single-threaded at the dispatcher level so this can be a
    /// plain static var without locking.
    nonisolated(unsafe) private static var clientRef: MIDIClientRef = 0
    nonisolated(unsafe) private static var sourceRef: MIDIEndpointRef = 0
    nonisolated(unsafe) private static var initialized = false

    private static func ensureInitialized() throws {
        if initialized { return }
        let clientStatus = MIDIClientCreate("TaskWraith" as CFString, nil, nil, &clientRef)
        guard clientStatus == noErr else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "creative.dispatchMIDI: MIDIClientCreate failed (\(clientStatus))"
            )
        }
        let sourceStatus = MIDISourceCreate(clientRef, "TaskWraith" as CFString, &sourceRef)
        guard sourceStatus == noErr else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "creative.dispatchMIDI: MIDISourceCreate failed (\(sourceStatus))"
            )
        }
        initialized = true
    }

    /// Send a single MIDI event. `event` is one of:
    ///   - "note_on": requires channel (0-15), note (0-127), velocity (0-127)
    ///   - "note_off": same args as note_on (velocity often 0)
    ///   - "cc": requires channel, controller (0-127), value (0-127)
    ///   - "program_change": requires channel, program (0-127)
    ///   - "transport_play": MMC Play (channel/note/etc ignored)
    ///   - "transport_stop": MMC Stop
    static func dispatchEvent(eventType: String, params: [String: Any]) throws -> [String: Any] {
        try ensureInitialized()
        let bytes = try buildEventBytes(eventType: eventType, params: params)
        var packetList = MIDIPacketList()
        let packet = MIDIPacketListInit(&packetList)
        _ = MIDIPacketListAdd(
            &packetList,
            MemoryLayout<MIDIPacketList>.size,
            packet,
            0,
            bytes.count,
            bytes
        )
        let status = MIDIReceived(sourceRef, &packetList)
        guard status == noErr else {
            throw JSONRPCError(
                code: JSONRPCErrorCode.internalError,
                message: "creative.dispatchMIDI: MIDIReceived failed (\(status))"
            )
        }
        return [
            "ok": true,
            "eventType": eventType,
            "byteCount": bytes.count,
            "sourceName": "TaskWraith"
        ]
    }

    /// Build the raw byte array for a MIDI event. Throws on invalid
    /// params (channel/note/velocity/controller out of range, etc).
    /// Pure function — easy to test by passing a fake state.
    static func buildEventBytes(eventType: String, params: [String: Any]) throws -> [UInt8] {
        func u8(_ key: String, range: ClosedRange<Int> = 0...127) throws -> UInt8 {
            guard let raw = params[key] as? Int else {
                throw JSONRPCError(
                    code: JSONRPCErrorCode.invalidParams,
                    message: "creative.dispatchMIDI \(eventType) requires integer param \(key)"
                )
            }
            guard range.contains(raw) else {
                throw JSONRPCError(
                    code: JSONRPCErrorCode.invalidParams,
                    message: "creative.dispatchMIDI \(eventType) param \(key) must be in \(range), got \(raw)"
                )
            }
            return UInt8(raw)
        }
        switch eventType {
        case "note_on":
            let channel = try u8("channel", range: 0...15)
            let note = try u8("note")
            let velocity = try u8("velocity")
            return [0x90 | channel, note, velocity]
        case "note_off":
            let channel = try u8("channel", range: 0...15)
            let note = try u8("note")
            let velocity = try u8("velocity")
            return [0x80 | channel, note, velocity]
        case "cc":
            let channel = try u8("channel", range: 0...15)
            let controller = try u8("controller")
            let value = try u8("value")
            return [0xB0 | channel, controller, value]
        case "program_change":
            let channel = try u8("channel", range: 0...15)
            let program = try u8("program")
            return [0xC0 | channel, program]
        case "transport_play":
            // MIDI Machine Control Play: F0 7F <device-id> 06 02 F7.
            // Device id 0x7F = "all devices" (broadcast).
            return [0xF0, 0x7F, 0x7F, 0x06, 0x02, 0xF7]
        case "transport_stop":
            // MMC Stop: F0 7F <device-id> 06 01 F7.
            return [0xF0, 0x7F, 0x7F, 0x06, 0x01, 0xF7]
        default:
            throw JSONRPCError(
                code: JSONRPCErrorCode.invalidParams,
                message:
                    "creative.dispatchMIDI: unknown eventType \"\(eventType)\". Allowed: note_on, note_off, cc, program_change, transport_play, transport_stop"
            )
        }
    }
}
