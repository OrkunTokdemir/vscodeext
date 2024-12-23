## Build

For building a native exectuable, use the `build` command.

```bash
$ go build .
```

This will generate the `qtcli` executable for your current platform and architecture.

## Cross-Platform Build

To build for a different platform and architecture, set `GOOS` and `GOARCH` environment variables:

For example, if you run,

```bash
$ GOOS=darwin GOARCH=arm64 go build .
$ GOOS=windows GOARCH=amd64 go build .
```

The result will be,

```bash
$ file qtcli
qtcli: Mach-O 64-bit arm64 executable, flags:<|DYLDLINK|PIE>
$ file qtcli.exe
qtcli.exe: PE32+ executable (console) x86-64, for MS Windows, 15 sections
```

## Packaging

This project uses `goreleaser` to simplify the deployment step. Install it with:

```bash
$ go install github.com/goreleaser/goreleaser/v2@latest
```

### Making a Snapshot

To build binaries and archives for the current state of your project:

```bash
$ goreleaser --snapshot --clean --skip=publish
```

Artifacts will be saved in the `dist/` folder.

If your project doesn't have a valid `Git` tag, set the `GORELEASER_CURRENT_TAG` environment variable:

```bash
$ GORELEASER_CURRENT_TAG=v1.0.0 goreleaser --snapshot --clean --skip=publish
```
