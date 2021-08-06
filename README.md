# CodeChecker VSCode Plugin

This is a C/C++ code analysis plugin for VSCode that shows bugs detected by the [Clang Static Analyzer] and [Clang Tidy] analyzers, using [CodeChecker] as a backend.

[Clang Static Analyzer]: http://clang-analyzer.llvm.org/
[Clang Tidy]: http://clang.llvm.org/extra/clang-tidy/
[CodeChecker]: https://github.com/Ericsson/codechecker

## Quick Start

1. [Install CodeChecker](https://github.com/Ericsson/CodeChecker#install-guide).
2. [Install the CodeChecker extension for Visual Studio Code](https://github.com/Ericsson/CodeCheckerVSCodePlugin/releases).
3. [Run a CodeChecker analysis on your project](https://github.com/Ericsson/codechecker/blob/master/docs/usage.md).
4. Open your project, and browse through the found reports!

## Features

This is an early development version, and features are constantly being added.  
Once a core set of features is implemented, this section will be populated!

## Commands and tasks

The extension provides the following commands:

* Reload Metadata: Reloads CodeChecker's `metadata.json` file.
  * `codechecker.backend.reloadMetadata`
* Next/Previous Step: Moves between a displayed reproduction path's steps.
  * `codechecker.backend.nextStep`, `codechecker.backend.previousStep`
  * Default: `Ctrl-F7`, `Ctrl-Shift-F7` respectively

## Settings

Since CodeChecker-related paths vary greatly between systems, the following settings are provided, accessible through the Settings menu:

* Output folder: The output folder where the CodeChecker analysis files are stored.
  * `codechecker.backend.outputFolder`, default value: `${workspaceFolder}/.codechecker`

## Development

This extension uses Node.js (v12+) and Yarn (v1.x).
Recommended VS Code extensions are [ESLint] and [TypeScript+Webpack Problem Matcher]

To build and run the extension, do the following:

* `yarn install --frozen-lockfile`, to install dependencies
* Open in Visual Studio Code (`code .`)
* Press F5 to start debugging
  
To run tests, select Extension Tests as the active debug configuration, or run `yarn run test`.

[ESLint]: https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint
[TypeScript+Webpack Problem Matcher]: https://marketplace.visualstudio.com/items?itemName=eamodio.tsl-problem-matcher

## License

The extension is released under the [Apache 2.0 license], the same license as [CodeChecker].

[Apache 2.0 license]: https://github.com/Ericsson/CodecheckerVSCodePlugin/blob/main/LICENSE
