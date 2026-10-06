import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
// usage: crop.swift input.png outprefix sliceHeight
let input = args[1]
let prefix = args[2]
let sliceH = Int(args[3])!

let url = URL(fileURLWithPath: input)
guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    fatalError("cannot read \(input)")
}
let w = img.width, h = img.height
var y = 0, i = 0
while y < h {
    let hh = min(sliceH, h - y)
    let rect = CGRect(x: 0, y: y, width: w, height: hh)
    guard let cropped = img.cropping(to: rect) else { fatalError("crop fail") }
    let outURL = URL(fileURLWithPath: String(format: "%@-%02d.png", prefix, i))
    guard let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("dest fail") }
    CGImageDestinationAddImage(dest, cropped, nil)
    CGImageDestinationFinalize(dest)
    y += sliceH; i += 1
}
print("\(i) slices for \(input)")
