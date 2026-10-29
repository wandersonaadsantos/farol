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
    targets: [
        .target(name: "FarolContrato"),
        .target(name: "FarolSidecar", dependencies: ["FarolContrato"]),
        // O ícone da bandeja viaja como recurso do pacote, junto do código que o usa.
        .target(
            name: "FarolApp",
            dependencies: ["FarolContrato", "FarolSidecar"],
            resources: [.copy("Resources/tray.png")]
        ),
        .testTarget(name: "FarolContratoTests", dependencies: ["FarolContrato"]),
        .testTarget(name: "FarolSidecarTests", dependencies: ["FarolSidecar"]),
        .testTarget(name: "FarolAppTests", dependencies: ["FarolApp"]),
    ]
)
