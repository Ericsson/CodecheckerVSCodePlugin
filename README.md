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
* Analyze current file: Analyzes the currently opened source file using CodeChecker.
  * `codechecker.executor.analyzeCurrentFile`
* Analyze selected files...: Analyzes the files selected by the user, using CodeChecker.
  * Accepts multiple files as input.
  * `codechecker.executor.analyzeSelectedFiles`
* Analyze entire project: Analyzes the entire project using CodeChecker.
  * `codechecker.executor.analyzeProject`
* Show full command line: Shows the full CodeChecker command line, used to analyze files.
  * `codechecker.executor.showCommandLine`
* Show Output: Focuses CodeChecker's output in the editor.
  * `codechecker.logging.showOutput`
* Reload Metadata: Reloads CodeChecker's `metadata.json` file.
  * `codechecker.backend.reloadMetadata`
* Stop analysis: Stops the currently running analysis.
  Partial results are saved and updated.
  * `codechecker.executor.stopAnalysis`

The analysis commands are also available in task form:
* Analyze current file
  * `type: "CodeChecker", taskType: ""`
* Analyze selected files
  * Selected files are given in the `selectedFiles` array, using full path.
  * `type: "CodeChecker", taskType: "selectedFiles", selectedFiles: []`
* Analyze entire project
  * `type: "CodeChecker", taskType: "project"`

## Settings

Since CodeChecker-related paths vary greatly between systems, the following settings are provided, accessible through the Settings menu:

* Output folder: The output folder where the CodeChecker analysis files are stored.
  * `codechecker.backend.outputFolder`, default value: `${workspaceFolder}/.codechecker`
* Executable path: Path to the CodeChecker executable. (Can be an executable in the PATH.)
  * `codechecker.executor.executablePath`, default value: `codechecker`
* Arguments: Additional arguments to CodeChecker.
  The command `CodeChecker: Show full command line` shows the resulting command line.
  * `codechecker.executor.arguments`, default value: *(empty)*
* Thread count: CodeChecker's thread count - leave empty to use all threads.
  * `codechecker.executor.threadCount`, default value: *(empty)*
* Run on save: Controls auto-run of CodeChecker on saving a file.
  * `codechecker.executor.runOnSave`, default value: `on`

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
