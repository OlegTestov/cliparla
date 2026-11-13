// Width of the indicator text in the macOS system font (medium, 0.025em tracking; 14 px unless a size is given).
// Run: swiftc -O tools/measure-indicator-text.swift -o /tmp/measure && /tmp/measure src/renderer/src/i18n/locales listening.copied '⌘V' [size]
// {{s}} is measured as 15, {{size}} as 5.00.
import AppKit
let args = CommandLine.arguments
let dir = args[1], key = args[2], paste = args[3]
let size = args.count > 4 ? CGFloat(Double(args[4])!) : 14
let font = NSFont.systemFont(ofSize: size, weight: .medium)
let files = try! FileManager.default.contentsOfDirectory(atPath: dir).filter { $0.hasSuffix(".json") }.sorted()
for f in files {
    let data = try! Data(contentsOf: URL(fileURLWithPath: dir + "/" + f))
    let json = try! JSONSerialization.jsonObject(with: data) as! [String: String]
    var text = json[key]!.replacingOccurrences(of: "{{paste}}", with: paste).replacingOccurrences(of: "{{s}}", with: "15").replacingOccurrences(of: "{{size}}", with: "5.00")
    text = text.replacingOccurrences(of: "\u{2066}", with: "").replacingOccurrences(of: "\u{2069}", with: "")
    let attr = NSAttributedString(string: text, attributes: [.font: font, .kern: size * 0.025])
    let w = attr.size().width
    print("\(f.replacingOccurrences(of: ".json", with: ""))\t\(String(format: "%.0f", w.rounded(.up)))\t\(text)")
}
