// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FarolKit",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "FarolContrato", targets: ["FarolContrato"]),
        .library(name: "FarolSidecar", targets: ["FarolSidecar"]),
        .library(name: "FarolApp", targets: ["FarolApp"]),
    ],
    // A Sparkle (atualização da casca) é dependência só da FarolApp: a FarolContrato segue pura
    // e a FarolSidecar segue sem interface.
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")
    ],
    targets: [
        .target(name: "FarolContrato"),
        .target(name: "FarolSidecar", dependencies: ["FarolContrato"]),
        // O ícone da bandeja viaja como recurso do pacote, junto do código que o usa.
        .target(
            name: "FarolApp",
            dependencies: [
                "FarolContrato", "FarolSidecar",
                .product(name: "Sparkle", package: "Sparkle"),
            ],
            resources: [.copy("Resources/tray.png")]
        ),
        .testTarget(name: "FarolContratoTests", dependencies: ["FarolContrato"]),
        .testTarget(name: "FarolSidecarTests", dependencies: ["FarolSidecar"]),
        .testTarget(name: "FarolAppTests", dependencies: ["FarolApp"]),
    ]
)
