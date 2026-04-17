# Step 04: Device selection and cropping helpers

def select_device(devices, fallback_class_ids=None):
    if not devices:
        raise ValueError("No devices were detected in the image.")

    fallback_class_ids = fallback_class_ids or {2, 4}
    ordered_devices = sorted(
        devices,
        key=lambda d: (d["class_id"] in fallback_class_ids, d["class_name"])
    )

    print("\nDetected devices:")
    for idx, device in enumerate(ordered_devices, start=1):
        units = device.get("units") or []
        units_label = ",".join(units) if units else "unknown"
        print(f"  {idx}. {device['class_name']} - units={units_label} - box={device['box']}")

    while True:
        choice = input("Enter device index to select (or press Enter for 1): ").strip()
        if choice == "":
            return ordered_devices[0]
        if choice.isdigit() and 1 <= int(choice) <= len(ordered_devices):
            return ordered_devices[int(choice) - 1]
        print("Invalid selection. Choose a valid device index.")


def crop_device_with_origin(img, box, pad=8):
    x1, y1, x2, y2 = box
    h, w = img.shape[:2]
    ox = max(0, x1 - pad)
    oy = max(0, y1 - pad)
    crop = img[oy:min(h, y2 + pad), ox:min(w, x2 + pad)]
    return crop, (ox, oy)
