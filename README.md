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

## Automatic CodeChecker analysis

The extension supports *automatic analysis* of changed files. When you save a file, or use one of the `CodeChecker: Analyze` commands, CodeChecker starts an analysis in the background. You can *stop the analysis* by clicking the *Cancel* button on CodeChecker's notification - partial results are saved automatically.

The analysis is fully configurable, and the resulting CodeChecker command line can be previewed with the `CodeChecker: Show full command line` command (for supported arguments, run `CodeChecker analyze --help`). Automatic analysis on saving can be configured as well.

You can view the output of previous CodeChecker analyses by clicking CodeChecker in the status bar, or using the `CodeChecker: Show Output` command.

## Commands and tasks

The extension provides the following commands:

| Command | Description |
| --- | --- |
| `CodeChecker: Analyze current file` | Analyzes the currently opened source file using CodeChecker. Can also be called by clicking on the `Re-analyze current file` button in CodeChecker's side panel. <br> Useful when the `Run On Save` is turned off in the plugin's settings. |
| `CodeChecker: Analyze selected files...` | Analyzes the files selected by the user, using CodeChecker. Accepts multiple files as input. |
| `CodeChecker: Analyze entire project` | Analyzes the entire project using CodeChecker. Can also be called by clicking on the `Re-analyze entire project` button in CodeChecker's side panel.<br> *Warning:* A full analysis can take minutes, or even hours on larger projects. |
| `CodeChecker: Stop analysis` | Stops the currently running analysis. Partial results are saved and updated. |
| `CodeChecker: Show database setup dialog` | Shows the dialog to select the path to an existing compilation database, or to create a new one. |
| `CodeChecker: Next reproduction step`, <br> `CodeChecker: Previous reproduction step` | Moves between a displayed reproduction path's steps. You can also navigate directly to a report's step via CodeChecker's side panel. <br> Default keybinds: `Ctrl-F7`, `Ctrl-Shift-F7` respectively. |
| `CodeChecker: Show full command line` | Shows the full CodeChecker command line used to analyze files. <br> Useful if you want to review the analyzer's options before running, or if you want to run the analysis manually. |
| `CodeChecker: Show Output` | Focuses CodeChecker's output in the editor. The plugin's logs, as well as the output of previous CodeChecker runs are displayed here. |
| `CodeChecker: Reload metadata` | Reloads CodeChecker's `metadata.json` file. Can also be called by clicking on the `Reload CodeChecker metadata` button on the CodeChecker's side panel. |


The analysis commands are also available in task form:
| **Task** | **Equivalent command** |
| --- | --- |
| `{ type: "CodeChecker", taskType: "currentFile" }` | `CodeChecker: Analyze current file` |
| `{ type: "CodeChecker", taskType: "selectedFiles", selectedFiles: [] }` | `CodeChecker: Analyze selected files...` <br> Selected files are listed in the `selectedFiles` array, using full paths. |
| `{ type: "CodeChecker", taskType: "project" }` | `CodeChecker: Analyze entire project` |

## Settings

Since CodeChecker-related paths vary greatly between systems, the following settings are provided, accessible through the Settings menu:

| Name | Description |
| --- | --- |
| CodeChecker > Backend > Output folder <br> (default: `${workspaceFolder}/.codechecker`) | The output folder where the CodeChecker analysis files are stored. |
| CodeChecker > Backend > Database path <br> (default: *(empty)*) | Path to a custom compilation database, in case of a custom build system. The database setup dialog sets the path for the current workspace only. |
| CodeChecker > Editor > Show database dialog <br> (default: `on`) | Controls the dialog when opening a workspace without a compilation database. |
| CodeChecker > Executor > Executable path <br> (default: `CodeChecker`) |  Path to the CodeChecker executable (can be an executable in the `PATH` environment variable). |
| CodeChecker > Executor > Thread count <br> (default: *(empty)*) | CodeChecker's thread count - leave empty to use all threads. |
| CodeChecker > Executor > Arguments <br> (default: *(empty)*) | Additional arguments to CodeChecker. For supported arguments, run `CodeChecker analyze --help`. <br> *Note:* The resulting command-line can be previewed with the command `CodeChecker: Show full command line`. |
| CodeChecker > Executor > Run on save <br> (default: `on`) | Controls auto-run of CodeChecker on saving a file. |

## Development

This extension uses Node.js (v12+) and Yarn (v1.x).
Recommended VS Code extensions are [ESLint] and [TypeScript+Webpack Problem Matcher]

To build and run the extension, do the following:

* `yarn install --frozen-lockfile`, to install dependencies
* Open in Visual Studio Code (`code .`)
* Press F5 to start debugging
  
To run tests, select Extension Tests as the active debug configuration, or run `yarn run test`.

[ESLint]: https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint
[TypeScript+Webpack Problem Matcher]: https://marketplace.visualstudio.com/items?itemName=amodio.tsl-problem-matcher

## License

The extension is released under the [Apache 2.0 license], the same license as [CodeChecker].

[Apache 2.0 license]: https://github.com/Ericsson/CodecheckerVSCodePlugin/blob/main/LICENSE
