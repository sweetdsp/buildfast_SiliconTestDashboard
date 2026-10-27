"""Shared catalog: domains, features, root-cause defects. Used by both generators."""

SEED = 20261020

SUBSYSTEMS = {
    "HCI": "Host-Controller Interface (HCI)",
    "AUDIO": "Audio Codec / LC3 & ISO",
    "LM": "Link Manager / Link Layer",
    "PHY": "PHY & Baseband",
    "HOST": "Host Stack (L2CAP / GATT / ATT)",
    "SEC": "Security (SMP / SSP)",
    "PWR": "Coexistence & Power Management",
}

# (feature, code, n_tests, fail, blocked, subsystem, requirement_coverage_pct)
HCI_FEATURES = [
    ("LE_Advertising", "LEA", 260, 10, 0, "LM", 96),
    ("LE_Extended_Advertising", "LEX", 190, 2, 0, "LM", 91),
    ("LE_Periodic_Advertising", "LEP", 150, 1, 0, "LM", 88),
    ("LE_Scanning", "LES", 230, 2, 0, "LM", 94),
    ("LE_Connections", "LEC", 310, 4, 1, "LM", 95),
    ("LE_Audio_CIS_BIS", "CIS", 280, 75, 45, "AUDIO", 83),
    ("LE_Isochronous_Channels", "ISO", 170, 12, 8, "AUDIO", 86),
    ("LE_2M_PHY", "P2M", 140, 1, 0, "PHY", 93),
    ("LE_Coded_PHY", "PCD", 140, 5, 2, "PHY", 68),
    ("LE_Power_Control", "LPC", 110, 1, 0, "PHY", 61),
    ("LE_Data_Length_Ext", "LDL", 120, 1, 0, "LM", 97),
    ("LE_Privacy_RPA", "LPR", 130, 2, 0, "SEC", 90),
    ("BR_EDR_Connections", "BRC", 330, 15, 5, "LM", 95),
    ("BR_EDR_Inquiry_Paging", "BRI", 220, 1, 0, "PHY", 92),
    ("Sniff_Subrating", "SNF", 150, 3, 1, "PWR", 74),
    ("Role_Switch", "RSW", 140, 6, 4, "LM", 89),
    ("eSCO_SCO_Voice", "ESC", 200, 3, 1, "AUDIO", 91),
    ("SSP_Pairing", "SSP", 260, 3, 1, "SEC", 96),
    ("Link_Key_Management", "LKM", 170, 1, 0, "SEC", 94),
    ("GATT_ATT", "GAT", 380, 20, 10, "HOST", 92),
    ("L2CAP_Channels", "L2C", 340, 4, 1, "HOST", 93),
    ("HCI_Reset_Flow_Control", "HRF", 180, 4, 3, "HCI", 90),
    ("Vendor_Specific_Cmds", "VSC", 120, 1, 0, "HCI", 72),
    ("AFH_Channel_Map", "AFH", 130, 2, 1, "PHY", 87),
    ("WiFi_BT_Coex", "COX", 150, 4, 2, "PWR", 85),
]

PHONE_FEATURES = [
    ("Pairing_Bonding", "PAI", 90, 3, 0, "SEC", 96),
    ("A2DP_Streaming", "A2D", 110, 9, 1, "AUDIO", 92),
    ("HFP_Calling", "HFP", 90, 3, 1, "AUDIO", 90),
    ("AVRCP_Control", "AVR", 60, 2, 0, "HOST", 88),
    ("LE_Audio_Headset", "LAH", 100, 12, 6, "AUDIO", 84),
    ("LE_Audio_Broadcast", "LAB", 70, 6, 4, "AUDIO", 66),
    ("HID_Peripherals", "HID", 60, 1, 0, "HOST", 91),
    ("GATT_Client_Server", "GCS", 80, 2, 0, "HOST", 93),
    ("BLE_Scan_Beacon", "BSB", 50, 1, 0, "LM", 89),
    ("File_Transfer_OPP", "OPP", 50, 1, 0, "HOST", 85),
    ("PAN_Tethering", "PAN", 40, 1, 0, "HOST", 71),
    ("Multi_Device_Concurrency", "MDC", 80, 5, 2, "LM", 82),
    ("WiFi_BT_Coexistence", "WBC", 50, 3, 1, "PWR", 80),
    ("Reconnection_Stability", "REC", 40, 2, 0, "LM", 90),
    ("Suspend_Resume_Power", "SRP", 30, 2, 1, "PWR", 78),
]

PLATFORMS = ["MobilePlatform-A", "MobilePlatform-B", "MobilePlatform-C"]

# DUT -> platform. Platform-B DUTs carry most crashes (hardware-dependent signal).
DUT_PLATFORM = {}
for _i in range(1, 17):
    DUT_PLATFORM[f"DUT-{_i:02d}"] = (
        "MobilePlatform-B" if _i in (2, 5, 9, 14)
        else "MobilePlatform-C" if _i in (10, 11, 12, 13, 15, 16)
        else "MobilePlatform-A"
    )

# Crash / root-cause defects (ground truth). Subsystem is NOT emitted in run data;
# the dashboard agent must infer it from the ticket text.
# jira, signature, severity, subsystem, per-DUT crash counts, summary, description
CRASH_DEFECTS = [
    ("BTFW-4012", "NullPointerInLC3CodecBuffer", "Blocker", "AUDIO",
     {"DUT-02": 3, "DUT-05": 2, "DUT-09": 2, "DUT-14": 1},
     "Controller crash: NULL pointer dereference in LC3 codec buffer during CIS audio streaming",
     "LC3 encoder output buffer is released on CIS teardown while the ISO TX path still references it, causing a NULL dereference and controller reset. Reproduces on LE Audio unicast and broadcast streams; all dependent LE Audio test flows are blocked."),
    ("BTFW-4018", "LinkManagerTimeoutOnRoleSwitch", "Critical", "LM",
     {"DUT-01": 3, "DUT-07": 1},
     "Link manager timeout during role switch with active ACL traffic",
     "LMP role switch request is not answered within the LMP response timeout when ACL data is queued; link manager watchdog fires and the controller restarts. Seen on BR/EDR links with multiple connected peers."),
    ("BTFW-4022", "HCI_Reset_Hang_Post_A2DP_Stream", "Critical", "HCI",
     {"DUT-11": 2},
     "HCI_Reset hangs controller after A2DP stream stop (no Command Complete)",
     "Host issues HCI_Reset right after an A2DP stream is stopped; controller never returns Command Complete and the HCI transport stalls until power cycle."),
    ("BTFW-4027", "ISOSchedulerDeadlockOnBIGSync", "Blocker", "AUDIO",
     {"DUT-02": 2, "DUT-12": 1},
     "ISO scheduler deadlock when synchronizing to BIG while CIG is active",
     "ISO event scheduler deadlocks when a broadcast isochronous group (BIG) sync is established while a CIG is already scheduled; SDU delivery stops and the BIS receiver never recovers. Blocks isochronous and broadcast audio tests."),
    ("BTFW-4031", "AFHMapCorruptionUnderWifiCoex", "Critical", "PWR",
     {"DUT-02": 1, "DUT-06": 2},
     "AFH channel map corrupted when WiFi coexistence arbiter updates channel classification",
     "Concurrent update of the AFH channel map from the WiFi coex arbiter and the link layer corrupts the 79-channel map; links drop with supervision timeout under heavy WiFi load."),
    ("BTFW-4035", "SMPPairingStateMachineAssert", "Critical", "SEC",
     {"DUT-08": 1, "DUT-15": 1},
     "Assert in SMP pairing state machine on colliding pairing requests",
     "Two simultaneous pairing requests (LE Secure Connections and legacy) hit an unexpected state in the SMP pairing state machine and trigger a firmware assert; bonding database left inconsistent."),
    ("BTFW-4040", "SniffSubratingWatchdogReset", "Medium", "PWR",
     {"DUT-10": 2},
     "Watchdog reset when entering sniff subrating with pending ACL flush",
     "Low power mode entry with pending ACL flush leaves the power manager waiting on a flush-complete event that never arrives; watchdog resets the controller."),
    ("BTFW-4044", "PHYCodedRxGainOverflow", "Blocker", "PHY",
     {"DUT-05": 1, "DUT-09": 1},
     "AGC gain register overflow on Coded PHY S=8 receive at low RSSI",
     "Receiver gain control overflows when receiving Coded PHY (S=8) packets below -92 dBm, corrupting RX path state and crashing the baseband. Seen only on platform B RF front-end."),
    ("BTFW-4048", "GATTMtuExchangeNullDeref", "Critical", "HOST",
     {"DUT-04": 1, "DUT-13": 1},
     "NULL dereference in GATT MTU exchange when peer disconnects mid-procedure",
     "ATT MTU exchange response handler dereferences the connection context after the peer has disconnected; host stack crash on rapid connect/disconnect cycles."),
    ("BTFW-4052", "LinkSupervisionTimeoutRaceOnSniffExit", "Medium", "LM",
     {"DUT-03": 1},
     "Race between link supervision timer and sniff exit causes spurious disconnect",
     "Supervision timeout fires while exiting sniff mode, tearing down a healthy ACL link; single occurrence on long-duration run."),
    ("BTFW-4056", "L2CAPCreditUnderflowOnReconnect", "Critical", "HOST",
     {"DUT-16": 1},
     "L2CAP credit counter underflow after reconnect with credit-based flow control",
     "Credit counter for LE credit-based channels underflows on reconnect, stalling the channel and eventually triggering a host stack assert."),
    ("BTFW-4061", "PowerStateSuspendResumeHang", "Medium", "PWR",
     {"DUT-14": 1},
     "Controller hang on suspend/resume with active low power clock gating",
     "Resume from system suspend while clock gating is active leaves the controller in a half-powered state; requires watchdog reset."),
]

# Non-crash blocker.
EXTRA_BLOCKER = ("BTFW-4057", "Blocker", "AUDIO",
                 "LE Audio unicast stream cannot start after BIG teardown",
                 "After tearing down a broadcast group, creating a new unicast CIS fails with command disallowed until controller reset. Prerequisite step for every LE Audio headset test flow, so dependent tests are marked blocked.")

EXPLICIT_MAP = {
    ("HCI_REGRESSION", "LE_Audio_CIS_BIS"): [("BTFW-4012", 8), ("BTFW-4057", 3)],
    ("HCI_REGRESSION", "LE_Isochronous_Channels"): [("BTFW-4027", 8)],
    ("HCI_REGRESSION", "Role_Switch"): [("BTFW-4018", 8)],
    ("HCI_REGRESSION", "BR_EDR_Connections"): [("BTFW-4018", 3)],
    ("HCI_REGRESSION", "HCI_Reset_Flow_Control"): [("BTFW-4022", 8)],
    ("HCI_REGRESSION", "LE_Coded_PHY"): [("BTFW-4044", 8)],
    ("HCI_REGRESSION", "AFH_Channel_Map"): [("BTFW-4031", 6)],
    ("HCI_REGRESSION", "WiFi_BT_Coex"): [("BTFW-4031", 6)],
    ("HCI_REGRESSION", "SSP_Pairing"): [("BTFW-4035", 6)],
    ("HCI_REGRESSION", "LE_Privacy_RPA"): [("BTFW-4035", 4)],
    ("HCI_REGRESSION", "Sniff_Subrating"): [("BTFW-4040", 6), ("BTFW-4052", 3)],
    ("HCI_REGRESSION", "GATT_ATT"): [("BTFW-4048", 8)],
    ("HCI_REGRESSION", "L2CAP_Channels"): [("BTFW-4056", 5)],
    ("PHONE_TESTING", "LE_Audio_Headset"): [("BTFW-4012", 6), ("BTFW-4057", 6)],
    ("PHONE_TESTING", "LE_Audio_Broadcast"): [("BTFW-4027", 6), ("BTFW-4012", 3)],
    ("PHONE_TESTING", "A2DP_Streaming"): [("BTFW-4022", 5)],
    ("PHONE_TESTING", "Multi_Device_Concurrency"): [("BTFW-4018", 5)],
    ("PHONE_TESTING", "Suspend_Resume_Power"): [("BTFW-4061", 5)],
    ("PHONE_TESTING", "Reconnection_Stability"): [("BTFW-4056", 4)],
    ("PHONE_TESTING", "GATT_Client_Server"): [("BTFW-4048", 4)],
}

# Which defect gates (blocks) the blocked tests of a feature.
GATING = {
    ("HCI_REGRESSION", "LE_Audio_CIS_BIS"): "BTFW-4012",
    ("HCI_REGRESSION", "LE_Isochronous_Channels"): "BTFW-4027",
    ("HCI_REGRESSION", "Role_Switch"): "BTFW-4018",
    ("HCI_REGRESSION", "BR_EDR_Connections"): "BTFW-4018",
    ("HCI_REGRESSION", "HCI_Reset_Flow_Control"): "BTFW-4022",
    ("HCI_REGRESSION", "LE_Coded_PHY"): "BTFW-4044",
    ("HCI_REGRESSION", "GATT_ATT"): "BTFW-4048",
    ("HCI_REGRESSION", "AFH_Channel_Map"): "BTFW-4031",
    ("HCI_REGRESSION", "WiFi_BT_Coex"): "BTFW-4031",
    ("HCI_REGRESSION", "SSP_Pairing"): "BTFW-4035",
    ("HCI_REGRESSION", "Sniff_Subrating"): "BTFW-4040",
    ("HCI_REGRESSION", "L2CAP_Channels"): "BTFW-4056",
    ("PHONE_TESTING", "LE_Audio_Headset"): "BTFW-4057",
    ("PHONE_TESTING", "LE_Audio_Broadcast"): "BTFW-4027",
    ("PHONE_TESTING", "A2DP_Streaming"): "BTFW-4022",
    ("PHONE_TESTING", "Multi_Device_Concurrency"): "BTFW-4018",
    ("PHONE_TESTING", "Suspend_Resume_Power"): "BTFW-4061",
}

# Generic bug templates per subsystem: (summary, description). {f} = feature, {n} = number.
BUG_TEMPLATES = {
    "HCI": [
        ("HCI command opcode 0x{n:04X} times out under back-to-back issue",
         "Controller does not return Command Complete for the opcode within 2 s when the host issues commands back-to-back; HCI transport credits stall."),
        ("Number_Of_Completed_Packets event mismatch during {f}",
         "HCI flow control event reports fewer completed packets than were sent, host runs out of ACL buffers."),
        ("Vendor specific HCI command returns unexpected status in {f}",
         "Vendor opcode returns Command Disallowed (0x0C) after HCI reset sequence; event ordering differs from the HCI spec."),
        ("HCI event ordering violation: Command Status after Command Complete",
         "HCI event queue emits events out of order when two commands overlap, breaking host state machine."),
    ],
    "AUDIO": [
        ("LC3 decoder output underrun on frame {n} during {f}",
         "LC3 codec frame is delivered late to the audio path causing audible glitch and SDU sequence gap; seen with 10 ms frame interval."),
        ("CIS isochronous SDU sequence gap after {n} s of streaming",
         "ISO data path drops an SDU, sequence number skips, presentation delay exceeded; audio dropout on headset."),
        ("BIG sync lost intermittently during broadcast audio ({f})",
         "Broadcast isochronous group synchronization drops after a few minutes, receiver must re-sync; LE Audio broadcast glitch."),
        ("A2DP SBC bitpool negotiation produces stutter on {f}",
         "Codec bitpool renegotiation mid-stream causes buffer underrun and audio stutter on A2DP sink."),
        ("eSCO voice link drops packets, audio codec CVSD artefacts in {f}",
         "Retransmission window too short on eSCO link; voice quality degraded with codec buffer underrun."),
    ],
    "LM": [
        ("LL_CONNECTION_UPDATE_IND rejected with unexpected error in {f}",
         "Link layer rejects a valid connection parameter update when supervision timeout is close to the interval limit."),
        ("Link layer control procedure collision between PHY update and encryption start",
         "Simultaneous LL control PDUs are not serialised; link terminates with LMP response timeout."),
        ("Advertising set not restarted after connection terminates ({f})",
         "Link layer fails to resume an extended advertising set after the connectable PDU ends the connection."),
        ("Scan window overlap causes missed advertising reports in {f}",
         "Scheduler gives priority to connection events and starves the scanner; advertising reports are lost."),
        ("Role switch latency exceeds {n} ms on busy piconet",
         "Link manager role switch completes late when multiple ACL links are active; peers time out."),
    ],
    "PHY": [
        ("Packet error rate above limit at sensitivity level in {f}",
         "RX sensitivity measurement shows PER above 1% at -{n} dBm; receiver AGC and RF calibration drift suspected."),
        ("RSSI calibration offset out of range after temperature sweep",
         "RSSI readings are offset by several dB after thermal cycling; frequency offset and TX power also drift."),
        ("Frequency offset beyond tolerance on 2M PHY ({f})",
         "Carrier frequency offset exceeds +/-150 kHz after oscillator warm-up; baseband demodulation errors."),
        ("TX power step error on LE power control request",
         "Radio PA does not honour the requested TX power step, resulting in link margin errors."),
    ],
    "HOST": [
        ("L2CAP credit exhaustion on dynamic channel during {f}",
         "Credit based flow control stalls when peer returns credits late; L2CAP signalling channel closes."),
        ("GATT notification dropped when ATT MTU is larger than {n}",
         "Notifications larger than the default MTU are truncated or dropped; ATT prepare write queue overflow."),
        ("ATT error 0x{n:02X} returned for valid Read Blob request in {f}",
         "GATT server returns an unexpected ATT error on Read Blob for long attribute values; service discovery incomplete."),
        ("AVRCP browsing channel fails to open after SDP record update",
         "SDP record cache is stale after profile re-registration; AVRCP/L2CAP connection refused."),
        ("OBEX transfer aborts with L2CAP disconnect in {f}",
         "File transfer over RFCOMM/L2CAP is aborted after tens of MB; host stack sends unexpected disconnect."),
    ],
    "SEC": [
        ("SMP pairing fails with Confirm Value Failed in {f}",
         "LE Secure Connections pairing aborts with reason 0x04 when the peer uses a different key distribution order."),
        ("Link key not persisted in bonding database after reboot",
         "Bonded device requires re-pairing after power cycle; link key storage race with encryption key size negotiation."),
        ("Resolvable private address not resolved within {n} ms ({f})",
         "Controller resolving list update races with advertising, so peer identity address is not resolved; bonding fails."),
        ("SSP numeric comparison timeout when user confirmation is delayed",
         "Secure simple pairing times out after 30 s; key exchange and authentication fail."),
    ],
    "PWR": [
        ("Coexistence arbiter denies Bluetooth slot for {n} ms during WiFi burst ({f})",
         "Antenna sharing arbitration gives WiFi absolute priority; Bluetooth packets are missed and audio degrades."),
        ("Link lost on wake from suspend with low power clock gating ({f})",
         "Wake lock is released too early; the controller resumes without clock lock and the link drops."),
        ("Sniff subrating negotiation leaves link in inconsistent low power state",
         "Sniff attempt and subrating timeouts mismatch between peers; link wakes late and throughput drops."),
        ("Current consumption {n} uA above budget in idle connected state",
         "Idle current exceeds the power budget because clock gating is not entered between connection events."),
    ],
}

FAILURE_SIGNATURES = {
    "HCI": ["HCI_Command_Complete timeout (opcode 0x{n:04X}) - no event within 2000 ms",
            "Command Complete status 0x0C (Command Disallowed), expected 0x00",
            "Num_Completed_Packets mismatch: sent {n}, acked {m}"],
    "AUDIO": ["ISO SDU sequence gap detected (expected {n}, got {m})",
              "LC3 decode error on frame {n}: output underrun",
              "BIG sync lost after {n} ms"],
    "LM": ["LL_ROLE_SWITCH response timeout (T={n} ms)",
           "Supervision timeout during connection parameter update",
           "Unexpected LL_TERMINATE_IND reason 0x08"],
    "PHY": ["PER {n}.{m}% exceeds limit 1.0% at -{n2} dBm",
            "RSSI calibration offset {n}.{m} dB out of range",
            "Frequency offset {n} kHz beyond +/-150 kHz"],
    "HOST": ["L2CAP credit exhaustion on CID 0x{n:04X}",
             "ATT error 0x{m:02X} on Read Blob, expected success",
             "GATT MTU exchange returned {n}, expected 247"],
    "SEC": ["SMP Pairing Failed reason 0x{m:02X} (Confirm Value Failed)",
            "Link key missing from bonding DB after reboot",
            "RPA not resolved within {n} ms"],
    "PWR": ["Coex arbiter denied BT slot for {n} ms",
            "Wake from suspend: link lost",
            "Idle current {n} uA exceeds budget"],
}

KPI_TICKET_IDS = ["BTFW-4070", "BTFW-4071", "BTFW-4072", "BTFW-4073", "BTFW-4074"]

TOTAL_TICKETS = 179
SEVERITY_QUOTA = {"Blocker": 4, "Critical": 28, "Medium": 102, "Trivial": 45}
