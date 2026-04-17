import argparse
import json
import os
import sys
import cv2

# Ensure the project root is on sys.path when this script is run directly
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from pipeline.config_loader import load_json_config, ensure_dir
from pipeline.detection import (
    load_model,
    detect_objects,
    detect_switch_patch,
    print_model_classes,
    validate_device_stack,
    assign_devices_to_units,
    build_device_mapping,
    build_unit_grid,
    remove_overlapping_devices,
    verify_devices_with_yolov8s,
    KEEP_DEVICE_CLASS_IDS,
    FALLBACK_DEVICE_CLASS_IDS,
)
from pipeline.annotation import (
    annotate_units_only,
    annotate_devices_only,
    annotate_image,
    annotate_full_rack,
    save_json,
)
from pipeline.selection import select_device, crop_device_with_origin
from pipeline.port import draw_classified
from pipeline.port_pattern import classify_ports_by_pattern, detect_patch_panel_ports
from pipeline.cable import (
    load_cable_model,
    classify_cable,
    crop_box,
    parse_cable_type_color,
    load_port_identify_model,
    classify_port_type,
)

# Step 06: Pipeline runner

def unit_label_to_index(label):
    return int(label.strip().lower().lstrip("u"))


def format_unit_range(unit_labels):
    indices = sorted(unit_label_to_index(label) for label in unit_labels)
    ranges = []
    start = prev = indices[0]
    for idx in indices[1:]:
        if idx == prev + 1:
            prev = idx
        else:
            ranges.append((start, prev))
            start = prev = idx
    ranges.append((start, prev))
    return ranges


def build_unit_device_lines(units, devices):
    assigned_units = set()
    lines = []

    for device in devices:
        unit_labels = device.get("units") or []
        if not unit_labels:
            continue
        assigned_units.update(unit_labels)
        ranges = format_unit_range(unit_labels)
        for start, end in ranges:
            if start == end:
                line = f"U{start:02d} {device['class_name']}"
            else:
                count = end - start + 1
                line = f"U{start:02d}-U{end:02d} {device['class_name']} - {count} spaces occupied"
            lines.append((start, line))

    for unit in units:
        if unit["label"] not in assigned_units:
            idx = unit_label_to_index(unit["label"])
            lines.append((idx, f"U{idx} Empty"))

    lines.sort(key=lambda item: item[0])
    return [line for _, line in lines]


def save_unit_device_report(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        f.write("U#\tDevice Type\n")
        for line in lines:
            f.write(line + "\n")


def parse_args():
    parser = argparse.ArgumentParser(description="Run rack unit and device detection, then highlight ports.")
    parser.add_argument("--image", required=True, help="Input rack image path.")
    parser.add_argument("--config", default="config.json", help="Path to pipeline config file.")
    parser.add_argument("--device_index", type=int, help="Select device index without prompt.")
    parser.add_argument("--port", type=int, help="Port number to highlight in the selected device image.")
    parser.add_argument("--list_device_classes", action="store_true",
                        help="Print device model classes and exit.")
    parser.add_argument("--output_dir", help="Override output directory from config.")
    parser.add_argument("--devices_conf", type=float, help="Confidence threshold for main device detection.")
    parser.add_argument("--switch_patch_conf", type=float, help="Confidence threshold for switch/patch panel detection.")
    parser.add_argument("--ports_conf", type=float, help="Confidence threshold for port detection.")
    parser.add_argument("--detect_only", action="store_true",
                        help="Run detection and annotation only; skip device and port selection.")
    return parser.parse_args()


def main():
    args = parse_args()
    config = load_json_config(args.config)

    output_dir = args.output_dir or config.get("paths", {}).get("output_dir", "outputs")
    ensure_dir(output_dir)

    unit_model_path = config["models"].get("units")
    switch_patch_model_path = config["models"]["switch_patch"]
    devices_model_path = config["models"]["devices"]
    device_8s_model_path = config["models"].get("device_8s")
    port_model_path = config["models"]["port_count"]
    cable_model_path = config["models"].get("cable_classifier")
    port_identify_model_path = config["models"].get("port_identify")

    devices_conf = args.devices_conf if args.devices_conf is not None else config.get("detection", {}).get("devices_conf", 0.3)
    switch_patch_conf = args.switch_patch_conf if args.switch_patch_conf is not None else config.get("detection", {}).get("switch_patch_conf", devices_conf)
    ports_conf = args.ports_conf if args.ports_conf is not None else config.get("detection", {}).get("ports_conf", 0.23)
    device_8s_conf = config.get("detection", {}).get("device_8s_conf", 0.25)
    device_8s_iou = config.get("detection", {}).get("device_8s_iou", 0.5)

    device_model = load_model(devices_model_path)

    if args.list_device_classes:
        print_model_classes(device_model, "device")
        return

    img = cv2.imread(args.image)
    if img is None:
        raise FileNotFoundError(f"Unable to open input image: {args.image}")

    # --- Detect devices first ---
    switch_patch_model = load_model(switch_patch_model_path)
    switch_patch_devices = detect_switch_patch(img, switch_patch_model, conf=switch_patch_conf)

    main_devices = detect_objects(img, device_model, conf=devices_conf, allowed_class_ids=KEEP_DEVICE_CLASS_IDS)
    devices = switch_patch_devices + main_devices
    devices.sort(key=lambda d: d["box"][1])
    devices = remove_overlapping_devices(devices, max_overlap_ratio=0.3)

    # --- Post-verify device labels using device_8s.pt ---
    if device_8s_model_path:
        device_8s_model = load_model(device_8s_model_path)
        devices = verify_devices_with_yolov8s(
            img, devices, device_8s_model,
            conf=device_8s_conf, iou_thresh=device_8s_iou,
        )

    validate_device_stack(devices)

    # --- Build unit grid using YOLO unit model ---
    units_conf = config.get("detection", {}).get("units_conf", 0.25)
    units = build_unit_grid(img, unit_model_path=unit_model_path, conf=units_conf)

    # --- Clip units to rack extent (devices define the rack area) ---
    if devices and units:
        rack_top = min(d["box"][1] for d in devices)
        rack_bot = max(d["box"][3] for d in devices)
        units = [u for u in units
                 if u["center_y"] >= rack_top and u["center_y"] <= rack_bot]

        # Remove units that don't overlap ANY device (rack rails / artifacts)
        from pipeline.detection import _intersection_area
        units = [u for u in units
                 if any(_intersection_area(u["box"], d["box"]) > 0 for d in devices)]

        # Top/bottom rail filter: if first/last unit is at the image edge
        # and only overlaps Closed Units, it's a rack rail frame — remove it.
        for check_idx in [0, -1]:
            if not units:
                break
            u = units[check_idx]
            at_edge = u["box"][1] < 15 if check_idx == 0 else u["box"][3] > img.shape[0] - 15
            if at_edge:
                overlapping = [d for d in devices
                               if _intersection_area(u["box"], d["box"]) > 0]
                if overlapping and all(d["class_name"] == "Closed Unit" for d in overlapping):
                    units.pop(check_idx)

        for i, u in enumerate(units, 1):
            u["label"] = f"u{i:02d}"

    # --- Assign each unit to exactly one device ---
    devices = assign_devices_to_units(devices, units)
    devices = [d for d in devices if d.get("units")]

    device_mapping = build_device_mapping(devices)
    json_payload = {
        "image": args.image,
        "units_detected": [unit["label"] for unit in units],
        "device_mapping": device_mapping,
        "devices": devices,
    }

    units_only_path = os.path.join(output_dir, "1_units_only.png")
    devices_only_path = os.path.join(output_dir, "2_devices_only.png")
    combined_annotation_path = os.path.join(output_dir, "3_units_and_devices.png")
    json_path = os.path.join(output_dir, "device_unit_map.json")
    report_path = os.path.join(output_dir, "device_unit_report.txt")
    selected_device_path = os.path.join(output_dir, "4_selected_device.png")
    selected_device_port_path = os.path.join(output_dir, "5_selected_device_with_port.png")
    full_rack_output_path = os.path.join(output_dir, "6_full_rack_selected_port.png")
    rack_all_ports_path = os.path.join(output_dir, "7_rack_all_ports.png")

    report_lines = build_unit_device_lines(units, devices)
    save_unit_device_report(report_path, report_lines)

    cv2.imwrite(units_only_path, annotate_units_only(img, units))
    cv2.imwrite(devices_only_path, annotate_devices_only(img, devices))
    cv2.imwrite(combined_annotation_path, annotate_image(img, units, devices))

    print(f"Saved unit-only annotation to: {units_only_path}")
    print(f"Saved device-only annotation to: {devices_only_path}")
    print(f"Saved combined annotation to: {combined_annotation_path}")
    print(f"Saved unit/device report to: {report_path}")
    print("\nUnit report:")
    for line in report_lines:
        print(line)

    # --- Full rack with all devices' port boxes ---
    port_model_inst = load_model(port_model_path)
    rack_ports_img = img.copy()
    CLR_DEV = (0, 255, 0)
    CLR_CONSOLE = (255, 255, 0)   # cyan
    CLR_MAIN = (0, 0, 255)        # red
    CLR_SFP = (0, 255, 255)       # yellow
    MAIN_PORTS_ONLY = {"Patch Panel"}
    # Only run port detection on classes that actually have ports on the
    # visible face. Skipping the rest avoids hallucinated port boxes on
    # servers, storage chassis, PSUs, PDUs, etc.
    PORT_BEARING_CLASSES = {"Switch", "Patch Panel", "Firewall", "Gateway"}
    for dev in devices:
        dx1, dy1, dx2, dy2 = dev["box"]
        cv2.rectangle(rack_ports_img, (dx1, dy1), (dx2, dy2), CLR_DEV, 2)
        if dev["class_name"] not in PORT_BEARING_CLASSES:
            continue
        try:
            dev_crop, (ox, oy) = crop_device_with_origin(img, dev["box"])

            if dev["class_name"] in MAIN_PORTS_ONLY:
                classified = detect_patch_panel_ports(dev_crop, port_model_inst, conf=ports_conf)
            else:
                classified = classify_ports_by_pattern(dev_crop, port_model_inst, conf=ports_conf)
            for p, clr in ((classified.get('console_ports', []), CLR_CONSOLE),
                           (classified.get('main_ports', []), CLR_MAIN),
                           (classified.get('sfp_ports', []), CLR_SFP)):
                for port in p:
                    px1, py1, px2, py2 = port['box']
                    cv2.rectangle(rack_ports_img,
                                  (px1 + ox, py1 + oy), (px2 + ox, py2 + oy),
                                  clr, 1)
        except Exception:
            pass
    cv2.imwrite(rack_all_ports_path, rack_ports_img)
    print(f"Saved rack with all ports to: {rack_all_ports_path}")

    if args.detect_only:
        # Detect and classify ports only for port-bearing device classes.
        for dev in devices:
            if dev["class_name"] not in PORT_BEARING_CLASSES:
                dev["port_count"] = 0
                dev["ports"] = []
                dev["console_ports"] = []
                dev["sfp_ports"] = []
                dev["connected_ports"] = []
                continue
            try:
                dev_crop, _ = crop_device_with_origin(img, dev["box"])
                if dev["class_name"] in MAIN_PORTS_ONLY:
                    classified = detect_patch_panel_ports(dev_crop, port_model_inst, conf=ports_conf)
                else:
                    classified = classify_ports_by_pattern(dev_crop, port_model_inst, conf=ports_conf)
                dev["port_count"] = len(classified['main_ports'])
                dev["ports"] = classified['main_ports']
                dev["console_ports"] = classified['console_ports']
                dev["sfp_ports"] = classified['sfp_ports']
                dev["connected_ports"] = [p for p in classified['main_ports']
                                          if p.get("status") == "connected"]
            except Exception:
                dev["port_count"] = 0
                dev["ports"] = []
                dev["console_ports"] = []
                dev["sfp_ports"] = []
                dev["connected_ports"] = []
        save_json(json_path, json_payload)
        print(f"Saved unit/device mapping JSON to: {json_path}")
        print("[detect_only] Detection and port analysis complete.")
        return

    save_json(json_path, json_payload)
    print(f"Saved unit/device mapping JSON to: {json_path}")

    if not devices:
        raise SystemExit("No devices detected. Cannot continue to port detection.")

    if args.device_index is not None:
        if not 1 <= args.device_index <= len(devices):
            raise ValueError("device_index is out of range.")
        selected = devices[args.device_index - 1]
    else:
        selected = select_device(devices, fallback_class_ids=FALLBACK_DEVICE_CLASS_IDS)

    device_crop, crop_origin = crop_device_with_origin(img, selected["box"])
    cv2.imwrite(selected_device_path, device_crop)
    print(f"Saved selected device crop to: {selected_device_path}")

    port_model_inst = load_model(port_model_path)
    cable_model = load_cable_model(cable_model_path, device='cpu') if cable_model_path else None
    port_id_model = load_port_identify_model(port_identify_model_path, device='cpu') if port_identify_model_path else None

    if selected["class_name"] in MAIN_PORTS_ONLY:
        classified = detect_patch_panel_ports(device_crop, port_model_inst, conf=ports_conf)
    else:
        classified = classify_ports_by_pattern(device_crop, port_model_inst, conf=ports_conf)

    n_console = len(classified.get('console_ports', []))
    n_main = len(classified['main_ports'])
    n_sfp = len(classified.get('sfp_ports', []))
    n_other = len(classified.get('other_ports', []))

    pat = classified.get('pattern_info', {})
    cluster_sizes = pat.get('cluster_sizes', [])
    num_clusters = pat.get('num_clusters', 0)
    main_cluster_size = pat.get('main_cluster_size', 0)

    print(f"\nPort pattern: {num_clusters} cluster(s) — sizes {cluster_sizes}")
    print(f"  Main pattern: {main_cluster_size} ports/cluster")
    if n_console:
        print(f"  Console: {n_console} port(s)")
    if n_main:
        print(f"  Main:    {n_main} port(s)")
    if n_sfp:
        print(f"  SFP:     {n_sfp} port(s)")

    port_number = args.port
    if port_number is None:
        port_number = int(input(f"Enter main port number to select (1-{n_main}): "))

    annotated_device = draw_classified(device_crop, classified, highlight_idx=port_number)
    cv2.imwrite(selected_device_port_path, annotated_device)

    selected_port_info = {
        "port_number": port_number,
        "port_category": "main",
        "status": "unknown",
        "class_name": None,
        "confidence": None,
        "location": None,
        "cable_type": None,
        "cable_connector": None,
        "cable_color": None,
        "port_type": None,
    }

    selected_port_box = None
    if 1 <= port_number <= n_main:
        selected_port = classified['main_ports'][port_number - 1]
        selected_port_info["status"] = selected_port.get("status", "unknown")
        selected_port_info["class_name"] = selected_port.get("class_name")
        selected_port_info["confidence"] = selected_port.get("confidence")

        box = selected_port["box"]
        ox, oy = crop_origin
        selected_port_box = [box[0] + ox, box[1] + oy, box[2] + ox, box[3] + oy]
        selected_port_info["location"] = selected_port_box

        if selected_port_info["status"] == "connected" and cable_model is not None:
            port_crop = crop_box(img, selected_port_box, pad=25)
            cable_class = classify_cable(port_crop, cable_model)
            connector, color = parse_cable_type_color(cable_class)
            selected_port_info["cable_type"] = cable_class
            selected_port_info["cable_connector"] = connector
            selected_port_info["cable_color"] = color
        elif selected_port_info["status"] == "empty" and port_id_model is not None:
            port_crop = crop_box(img, selected_port_box, pad=10)
            port_type = classify_port_type(port_crop, port_id_model)
            selected_port_info["port_type"] = port_type
    else:
        selected_port_info["status"] = "invalid"

    cv2.imwrite(full_rack_output_path, annotate_full_rack(img, selected["box"], selected_port_box))

    selected_port_info_path = os.path.join(output_dir, "selected_port_info.json")
    with open(selected_port_info_path, "w", encoding="utf-8") as info_file:
        json.dump({
            "scan_image": args.image,
            "device_index": args.device_index,
            "selected_device": selected,
            "port_classification": {
                "console": n_console,
                "main": n_main,
                "sfp": n_sfp,
            },
            "port_info": selected_port_info,
        }, info_file, indent=2)

    print(f"Saved selected device with port annotation to: {selected_device_port_path}")
    print(f"Saved full rack selected-port annotation to: {full_rack_output_path}")
    print(f"Saved selected port info to: {selected_port_info_path}")
    print(f"Device '{selected['class_name']}' assigned to units {selected.get('units', [])}.")

    status = selected_port_info["status"]
    print(f"\nPort {port_number} (main): {status}")
    if selected_port_info["location"]:
        bx1, by1, bx2, by2 = selected_port_info["location"]
        print(f"  Location: x={bx1}, y={by1}, w={bx2 - bx1}, h={by2 - by1}")
    if status == "connected":
        connector = selected_port_info.get("cable_connector")
        color = selected_port_info.get("cable_color")
        if connector and color:
            print(f"  Cable Type: {connector}")
            print(f"  Cable Color: {color}")
        elif selected_port_info.get("cable_type"):
            print(f"  Cable: {selected_port_info['cable_type']}")
    elif status == "empty":
        port_type = selected_port_info.get("port_type")
        if port_type:
            print(f"  Port Type: {port_type}")


if __name__ == "__main__":
    main()
