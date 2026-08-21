#!/usr/bin/env python3
"""Generate PWA icons using pure Python (no PIL)."""
import struct
import zlib
import os

def make_png(width, height, pixels):
    """
    Create a PNG from a flat list of (R,G,B,A) tuples (row-major).
    pixels must be a list of length width*height, each element a 4-tuple.
    """
    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    # IHDR
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA

    # IDAT - raw filtered rows
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter type: None
        for x in range(width):
            idx = y * width + x
            r, g, b, a = pixels[idx]
            raw += struct.pack('BBBB', r, g, b, a)

    compressed = zlib.compress(raw)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', compressed)
            + chunk(b'IEND', b''))

def fill_gradient(width, height, top_color, bottom_color):
    """Create RGBA pixels with vertical gradient."""
    pixels = []
    for y in range(height):
        t = y / max(height - 1, 1)
        r = int(top_color[0] * (1 - t) + bottom_color[0] * t)
        g = int(top_color[1] * (1 - t) + bottom_color[1] * t)
        b = int(top_color[2] * (1 - t) + bottom_color[2] * t)
        a = int(top_color[3] * (1 - t) + bottom_color[3] * t)
        for x in range(width):
            pixels.append((r, g, b, a))
    return pixels

def draw_circle(pixels, width, height, cx, cy, r, fill_color, stroke_w=0):
    """Draw a filled circle with optional stroke."""
    for y in range(height):
        for x in range(width):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            if stroke_w > 0 and abs(dist - r) <= stroke_w:
                idx = y * width + x
                pixels[idx] = fill_color
            elif dist <= r - stroke_w:
                idx = y * width + x
                # Blend with background
                bg = pixels[idx]
                alpha = fill_color[3] / 255.0
                pixels[idx] = (
                    int(fill_color[0] * alpha + bg[0] * (1 - alpha)),
                    int(fill_color[1] * alpha + bg[1] * (1 - alpha)),
                    int(fill_color[2] * alpha + bg[2] * (1 - alpha)),
                    255
                )

def draw_text_simple(pixels, width, height, text, cx, cy, size, color):
    """Simple block-letter drawing for 'CC'."""
    # Draw 'C' shapes as two blocky C letters side by side
    # Each C is drawn in a grid of size x size*2 area
    
    char_w = size * 3 // 2
    char_h = size * 2
    gap = size // 3
    
    total_w = char_w * 2 + gap
    total_h = char_h
    
    start_x = cx - total_w // 2
    start_y = cy - total_h // 2
    
    for letter_idx in range(2):
        ox = start_x + letter_idx * (char_w + gap)
        oy = start_y
        
        # Draw a C shape: outline on left, top, bottom, right curve
        thickness = max(2, size // 5)
        
        for iy in range(char_h):
            for ix in range(char_w):
                # Left edge (top to bottom)
                if ix < thickness:
                    # Within left bar
                    px, py = ox + ix, oy + iy
                    if 0 <= px < width and 0 <= py < height:
                        idx = py * width + px
                        pixels[idx] = color
                # Top edge (from left bar to right)
                elif iy < thickness and ix < char_w - thickness:
                    px, py = ox + ix, oy + iy
                    if 0 <= px < width and 0 <= py < height:
                        idx = py * width + px
                        pixels[idx] = color
                # Bottom edge
                elif iy >= char_h - thickness and ix < char_w - thickness:
                    px, py = ox + ix, oy + iy
                    if 0 <= px < width and 0 <= py < height:
                        idx = py * width + px
                        pixels[idx] = color
                # Right curve (top part)
                elif ix >= char_w - thickness and iy < thickness * 3:
                    px, py = ox + ix, oy + iy
                    if 0 <= px < width and 0 <= py < height:
                        idx = py * width + px
                        pixels[idx] = color
                # Right curve (bottom part)
                elif ix >= char_w - thickness and iy >= char_h - thickness * 3:
                    px, py = ox + ix, oy + iy
                    if 0 <= px < width and 0 <= py < height:
                        idx = py * width + px
                        pixels[idx] = color

def create_icon(size, path):
    """Generate a CrewCall PWA icon."""
    w, h = size, size
    
    # Gradient: light blue to slightly darker blue
    top = (231, 242, 248, 255)    # light blue
    bottom = (200, 215, 225, 255)  # slightly darker
    
    pixels = fill_gradient(w, h, top, bottom)
    
    cx, cy = w // 2, h // 2
    
    # Outer ring (stroke only)
    ring_r = int(w * 0.40)
    draw_circle(pixels, w, h, cx, cy, ring_r, (0, 91, 150, 200), max(2, w // 40))
    
    # Inner ring (stroke only, thinner)
    inner_r = int(w * 0.28)
    draw_circle(pixels, w, h, cx, cy, inner_r, (0, 91, 150, 70), max(1, w // 60))
    
    # CC text
    text_size = w // 4
    draw_text_simple(pixels, w, h, "CC", cx, cy, text_size, (0, 91, 150, 255))
    
    # Write PNG
    png_data = make_png(w, h, pixels)
    with open(path, 'wb') as f:
        f.write(png_data)
    print(f"Created {path} ({size}x{size}, {len(png_data)} bytes)")

os.makedirs('icons', exist_ok=True)
create_icon(192, 'icons/icon-192.png')
create_icon(512, 'icons/icon-512.png')
print("Icons generated successfully!")