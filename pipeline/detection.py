import os
import cv2
import numpy as np
from ultralytics import YOLO

# Step 02: Detection utilities

KEEP_DEVICE_CLASS_IDS = {2, 4, 6, 9, 10, 14, 15, 17}
FALLBACK_DEVICE_CLASS_IDS = {2, 4}
PRIMARY_DEVICE_CLASS_IDS = KEEP_DEVICE_CLASS_IDS - FALLBACK_DEVICE_CLASS_IDS

SWITCH_PATCH_CLASS_NAME_MAP = {
    "Patch_Panel": "Patch Panel",
}

# device_8s.pt class label space (12 classes).
DEVICE_8S_CLASS_NAMES = {
    0: "Closed Unit",
    1: "Empty",
    2: "Firewall",
    3: "Gateway",
    4: "PDU",
    5: "PSU",
    6: "Patch Panel",
    8: "Server",
    9: "Closed Unit",    # was Storage Unit — remapped
    10: "Switch",
    11: "UPS",
}

# Verifier override priority: lower number = higher priority.
# 1) Switch / Patch Panel, 2) other real devices, 3) Empty, 4) Closed Unit.
DEVICE_8S_PRIORITY = {
    10: 1, 6: 1,                                    # Switch, Patch Panel
    2: 2, 3: 2, 4: 2, 5: 2, 8: 2, 11: 2,          # Firewall, Gateway, PDU, PSU, Server, UPS
    9: 4,                                           # Storage Unit → Closed Unit
    1: 3,                                           # Empty
    0: 4,                                           # Closed Unit
}


def load_model(model_path: str):
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")
    return YOLO(model_path)


def detect_objects(img, model, conf: float, allowed_class_ids=None):
    results = model(img, conf=conf)
    if not results or results[0].boxes is None:
        return []

    xyxy = results[0].boxes.xyxy.cpu().numpy()
    cls_ids = results[0].boxes.cls.cpu().numpy().astype(int)
    scores = results[0].boxes.conf.cpu().numpy()
    names = getattr(model, "names", {})

    detections = []
    for i, box in enumerate(xyxy):
        cls_id = int(cls_ids[i])
        if allowed_class_ids is not None and cls_id not in allowed_class_ids:
            continue
        x1, y1, x2, y2 = box
        detections.append({
            "class_id": cls_id,
            "class_name": str(names.get(cls_id, cls_id)),
            "confidence": float(scores[i]),
            "box": [int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))],
            "center": [int(round((x1 + x2) / 2)), int(round((y1 + y2) / 2))]
        })

    return detections


def print_model_classes(model, model_name: str):
    names = getattr(model, "names", {})
    print(f"\nAvailable classes for {model_name} model:")
    for class_id, class_name in sorted(names.items()):
        print(f"  {class_id}: {class_name}")


def remap_switch_patch_names(devices):
    for dev in devices:
        dev["class_name"] = SWITCH_PATCH_CLASS_NAME_MAP.get(dev["class_name"], dev["class_name"])
    return devices


def detect_switch_patch(img, model, conf: float):
    devices = detect_objects(img, model, conf=conf)
    return remap_switch_patch_names(devices)


def _iou(box_a, box_b):
    inter = _intersection_area(box_a, box_b)
    if inter == 0:
        return 0.0
    union = _box_area(box_a) + _box_area(box_b) - inter
    return inter / union if union > 0 else 0.0


def verify_devices_with_yolov8s(img, devices, model, conf=0.25, iou_thresh=0.5):
    """Re-label each existing device box using device_8s predictions.

    For each device box, look at all device_8s detections that overlap with
    IoU >= iou_thresh and pick the one with the highest priority
    (Switch/Patch Panel > other devices > Empty > Closed Unit). Ties on
    priority are broken by IoU, then confidence. If no device_8s detection
    overlaps a box, the original label is kept.
    """
    if not devices:
        return devices

    results = model(img, conf=conf, agnostic_nms=True)
    if not results or results[0].boxes is None or len(results[0].boxes) == 0:
        for dev in devices:
            print(f"[verify] no device_8s overlap for {dev['class_name']} box={dev['box']} — keeping original")
        return devices

    xyxy = results[0].boxes.xyxy.cpu().numpy()
    cls_ids = results[0].boxes.cls.cpu().numpy().astype(int)
    scores = results[0].boxes.conf.cpu().numpy()

    v8s_dets = []
    for box, cid, score in zip(xyxy, cls_ids, scores):
        x1, y1, x2, y2 = (int(round(v)) for v in box)
        v8s_dets.append({
            "class_id": int(cid),
            "class_name": DEVICE_8S_CLASS_NAMES.get(int(cid), str(cid)),
            "confidence": float(score),
            "box": [x1, y1, x2, y2],
            "priority": DEVICE_8S_PRIORITY.get(int(cid), 99),
        })

    for dev in devices:
        candidates = []
        for v in v8s_dets:
            iou = _iou(dev["box"], v["box"])
            if iou >= iou_thresh:
                candidates.append((v, iou))

        if not candidates:
            print(f"[verify] no device_8s overlap for {dev['class_name']} box={dev['box']} — keeping original")
            continue

        # priority asc, then IoU desc, then confidence desc
        best, best_iou = min(
            candidates,
            key=lambda c: (c[0]["priority"], -c[1], -c[0]["confidence"]),
        )
        if best["class_name"] != dev["class_name"]:
            print(
                f"[verify] relabel {dev['class_name']} -> {best['class_name']} "
                f"(iou={best_iou:.2f}, conf={best['confidence']:.2f})"
            )
            dev["class_name"] = best["class_name"]
            dev["class_id"] = best["class_id"]
        dev["verified_by"] = "device_8s"
        dev["verify_confidence"] = best["confidence"]
        dev["verify_iou"] = best_iou

    return devices


def build_unit_grid(img, unit_model_path=None, conf=0.25):
    """Build a unit grid using YOLO unit detection + post-processing.

    1. Detect units with YOLO → get count and approximate positions.
    2. Sort by y-position (top to bottom).
    3. Compute mean height and mean width.
    4. Make contiguous: y1[i] = y2[i-1] (no gaps, no overlaps).
    5. Standardize: all units = same height, same width, centered.
    """
    if unit_model_path is None:
        return []

    model = YOLO(unit_model_path)
    results = model(img, conf=conf)

    if not results or results[0].boxes is None or len(results[0].boxes) == 0:
        return []

    boxes = results[0].boxes.data.cpu().numpy()

    # Filter out "rail" detections if the model has named classes
    names = getattr(model, "names", {})
    cls_ids = boxes[:, 5].astype(int) if boxes.shape[1] > 5 else None
    if cls_ids is not None:
        keep = [i for i, cid in enumerate(cls_ids)
                if str(names.get(int(cid), "")).lower() != "rail"]
        if keep:
            boxes = boxes[keep]

    if len(boxes) < 1:
        return []

    # Sort by top y-coordinate (ascending)
    boxes = boxes[boxes[:, 1].argsort()]

    # Compute mean height and width
    heights = boxes[:, 3] - boxes[:, 1]
    widths = boxes[:, 2] - boxes[:, 0]
    mean_h = float(heights.mean())
    mean_w = float(widths.mean())

    # Make contiguous + standardize
    for i in range(len(boxes)):
        if i > 0:
            boxes[i][1] = boxes[i - 1][3]  # y1 = previous y2
        boxes[i][3] = boxes[i][1] + mean_h  # y2 = y1 + mean_h
        center_x = (boxes[i][0] + boxes[i][2]) / 2
        boxes[i][0] = center_x - mean_w / 2
        boxes[i][2] = center_x + mean_w / 2

    # Build unit dicts
    units = []
    for i, box in enumerate(boxes):
        x1, y1, x2, y2 = int(round(box[0])), int(round(box[1])), \
                          int(round(box[2])), int(round(box[3]))
        units.append({
            "box": [x1, y1, x2, y2],
            "center": [(x1 + x2) // 2, (y1 + y2) // 2],
            "center_y": (y1 + y2) / 2,
        })

    units = assign_units(units)
    return units


def assign_units(units):
    sorted_units = sorted(units, key=lambda u: u["box"][1])
    for index, unit in enumerate(sorted_units, start=1):
        unit["label"] = f"u{index:02d}"
        unit["center_y"] = (unit["box"][1] + unit["box"][3]) / 2
    return sorted_units


def _snap_to_edge(gray_roi, approx_y, half=45):
    h = gray_roi.shape[0]
    y1 = max(0, approx_y - half)
    y2 = min(h, approx_y + half + 1)
    if y2 <= y1:
        return approx_y
    strip = gray_roi[y1:y2, :].astype(np.float32)
    sobel = cv2.Sobel(strip, cv2.CV_32F, 0, 1, ksize=3)
    strength = np.abs(sobel).mean(axis=1)
    return y1 + int(np.argmax(strength))


def normalize_units(units, img):
    if not units:
        return units

    img_h, img_w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    left_x = max(0, min(u["box"][0] for u in units))
    right_x = min(img_w, max(u["box"][2] for u in units))
    gray_roi = gray[:, left_x:right_x]

    n = len(units)
    approx = [units[0]["box"][1]] + [u["box"][3] for u in units]
    snapped = sorted(set(_snap_to_edge(gray_roi, ay) for ay in approx))

    if len(snapped) < n + 1:
        top_y = snapped[0] if snapped else units[0]["box"][1]
        avg_h = max(1, int(round(sum(u["box"][3] - u["box"][1] for u in units) / n)))
        snapped = [min(img_h, top_y + i * avg_h) for i in range(n + 1)]

    row_pairs = [(snapped[i], snapped[i + 1]) for i in range(n)]

    for unit, (y1, y2) in zip(units, row_pairs):
        unit["box"] = [left_x, y1, right_x, y2]
        unit["center"] = [(left_x + right_x) // 2, (y1 + y2) // 2]
        unit["center_y"] = (y1 + y2) / 2

    return units


def _intersection_area(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0
    return (ix2 - ix1) * (iy2 - iy1)


def _box_area(box):
    x1, y1, x2, y2 = box
    return max(0, x2 - x1) * max(0, y2 - y1)


def _box_overlap_ratio(box_a, box_b):
    intersection = _intersection_area(box_a, box_b)
    if intersection == 0:
        return 0.0
    return intersection / min(_box_area(box_a), _box_area(box_b))


def is_device_inside_unit(device, unit, threshold=0.99):
    device_area = _box_area(device["box"])
    if device_area == 0:
        return False
    overlap = _intersection_area(device["box"], unit["box"])
    return overlap / device_area >= threshold


def filter_devices_inside_units(devices, units, threshold=0.99):
    filtered = []
    for dev in devices:
        if any(is_device_inside_unit(dev, unit, threshold=threshold) for unit in units):
            filtered.append(dev)
        else:
            print(f"[info] discarding device outside units: {dev['class_name']} box={dev['box']}")
    return filtered


def remove_overlapping_devices(devices, max_overlap_ratio=0.01):
    filtered = []
    for dev in sorted(devices, key=lambda d: (d["box"][1], -d["confidence"])):
        keep = True
        for kept in filtered:
            if _box_overlap_ratio(dev["box"], kept["box"]) > max_overlap_ratio:
                keep = False
                print(f"[info] removing overlapping device: {dev['class_name']} overlaps {kept['class_name']}")
                break
        if keep:
            filtered.append(dev)
    return filtered


def validate_device_stack(devices):
    for i, a in enumerate(devices):
        for b in devices[i + 1:]:
            if _intersection_area(a["box"], b["box"]) > 0:
                print(f"[warning] overlapping devices detected: {a['class_name']} vs {b['class_name']}")


def assign_devices_to_units(devices, units):
    if not units:
        for dev in devices:
            dev["units"] = []
        return devices

    for dev in devices:
        dev["units"] = []

    unit_best = {
        unit["label"]: {
            "primary": None,
            "primary_overlap": 0,
            "fallback": None,
            "fallback_overlap": 0,
        }
        for unit in units
    }

    def is_fallback(dev):
        return dev["class_id"] in FALLBACK_DEVICE_CLASS_IDS

    for dev in devices:
        for unit in units:
            area = _intersection_area(dev["box"], unit["box"])
            unit_area = _box_area(unit["box"])
            if area <= 0 or unit_area <= 0:
                continue
            # Device must cover at least 25% of the unit to be assigned
            if area / unit_area < 0.25:
                continue
            entry = unit_best[unit["label"]]
            if is_fallback(dev):
                if area > entry["fallback_overlap"]:
                    entry["fallback"] = dev
                    entry["fallback_overlap"] = area
            else:
                if area > entry["primary_overlap"]:
                    entry["primary"] = dev
                    entry["primary_overlap"] = area

    for unit_label, entry in unit_best.items():
        chosen = entry["primary"] or entry["fallback"]
        if chosen is not None:
            chosen["units"].append(unit_label)

    # Ensure every unit has at least one device assigned.
    unit_assigned = {unit["label"]: False for unit in units}
    for dev in devices:
        for unit_label in dev["units"]:
            unit_assigned[unit_label] = True

    for unit in units:
        if unit_assigned[unit["label"]]:
            continue
        nearest = min(devices, key=lambda d: abs(d["center"][1] - unit["center_y"]))
        nearest["units"].append(unit["label"])
        unit_assigned[unit["label"]] = True

    for dev in devices:
        if not dev["units"]:
            nearest = min(units, key=lambda u: abs(dev["center"][1] - u["center_y"]))
            dev["units"].append(nearest["label"])

    return devices


def build_device_mapping(devices):
    mapping = {}
    for device in devices:
        for unit_label in device.get("units", []):
            mapping.setdefault(device["class_name"], set()).add(unit_label)
    return {name: sorted(list(units)) for name, units in mapping.items()}
