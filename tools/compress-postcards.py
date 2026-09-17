# -*- coding: utf-8 -*-
"""把原图压缩成游戏用的明信片素材 tools/compress-postcards.py

为什么必须压：
    2496x1664 的 RGBA 原图解码后在内存里约占 16.6MB/张（5 张 ~83MB），
    移动端一次性解码这么多位图会明显掉帧甚至崩溃 —— 卡顿的主因是"解码内存 + 解码耗时"，
    不只是下载体积。缩到 600x400 后降到 ~0.96MB/张，问题消失。

压缩要点：
    1. 先转 RGB：原图 alpha 全 255，透明通道是白占的空间。
    2. 两级 LANCZOS 缩小（先到 2 倍再到位），比一步缩小混叠更少、细节保留更好。
    3. 调色板量化到 256 色 + 不打抖动：AI 生成的像素风插画自带渐变纹理，
       打抖动只会增加噪点并把体积撑大。
    4. 输出比例与原图一致（3:2），不裁切不变形。

用法：
    python tools/compress-postcards.py                      # 用默认映射
    python tools/compress-postcards.py --width=720 --colors=192
    python tools/compress-postcards.py --src-dir=D:/pics --china=my.png
"""
from PIL import Image
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, 'assets', 'postcards')

# 国名 -> 源文件名。国名即输出文件名（和 index.html 里的 CARD_FILE 映射一一对应）
DEFAULT_MAP = {
    'china':  '微信图片_20260917185256_152_3.png',
    'italy':  '微信图片_20260917185256_153_3.png',
    'france': '微信图片_20260917185256_154_3.png',
    'mexico': '微信图片_20260917185256_155_3.png',
    'japan':  '微信图片_20260917185644_158_3.png',
}


def compress_one(src, dst, size, colors):
    """返回 (原始字节, 压缩后字节)"""
    im = Image.open(src).convert('RGB')          # 去掉无用的 alpha 通道
    im = (im.resize((size[0] * 2, size[1] * 2), Image.LANCZOS)
            .resize(size, Image.LANCZOS))        # 两级缩小，减少混叠
    im = im.quantize(colors=colors, method=Image.FASTOCTREE, dither=Image.NONE)
    im.save(dst, 'PNG', optimize=True)
    return os.path.getsize(src), os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser(description='压缩旅行明信片素材')
    ap.add_argument('--src-dir', default=os.path.join(os.path.expanduser('~'), 'Desktop'),
                    help='原图所在目录（默认：桌面）')
    ap.add_argument('--out-dir', default=DEFAULT_OUT, help='输出目录（默认：assets/postcards）')
    ap.add_argument('--width', type=int, default=600, help='输出宽度，高度按 3:2 自动算（默认 600）')
    ap.add_argument('--colors', type=int, default=256, help='调色板色数（默认 256）')
    for k in DEFAULT_MAP:
        ap.add_argument('--' + k, default=DEFAULT_MAP[k], help='%s 的源文件名' % k)
    a = ap.parse_args()

    size = (a.width, a.width * 2 // 3)           # 3:2，和原图比例一致
    os.makedirs(a.out_dir, exist_ok=True)

    total_in = total_out = 0
    missing = []
    for name in DEFAULT_MAP:
        src_name = getattr(a, name)
        src = os.path.join(a.src_dir, src_name)
        dst = os.path.join(a.out_dir, name + '.png')
        if not os.path.exists(src):
            missing.append(src_name)
            continue
        src_bytes, out_bytes = compress_one(src, dst, size, a.colors)
        total_in += src_bytes
        total_out += out_bytes
        print('%-8s %6.2f MB -> %6.1f KB  保留 %.1f%%   %s'
              % (name, src_bytes / 1048576.0, out_bytes / 1024.0,
                 out_bytes * 100.0 / src_bytes, os.path.basename(dst)))

    if missing:
        print('没找到的源图（已跳过）：' + '、'.join(missing), file=sys.stderr)
    if total_in:
        print('-' * 64)
        print('合计 %.2f MB -> %.1f KB   整体压到原来的 %.1f%%'
              % (total_in / 1048576.0, total_out / 1024.0, total_out * 100.0 / total_in))
    return 0 if not missing else 1


if __name__ == '__main__':
    sys.exit(main())
