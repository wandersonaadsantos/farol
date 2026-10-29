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
        .target(name: "FarolApp", dependencies: ["FarolContrato", "FarolSidecar"]),
        .testTarget(name: "FarolContratoTests", dependencies: ["FarolContrato"]),
        .testTarget(name: "FarolSidecarTests", dependencies: ["FarolSidecar"]),
        .testTarget(name: "FarolAppTests", dependencies: ["FarolApp"]),
    ]
)
