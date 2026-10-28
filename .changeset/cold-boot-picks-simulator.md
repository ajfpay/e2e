---
"@e2e-dev/mobile": patch
---

A mobile target with no `device` and nothing booted now boots one shut-down simulator or emulator itself: an iPhone on the newest iOS first, on Android the first AVD by name. The log names the device it picked. Before, the boot failed with "N devices match this request equally" on any machine with more than one simulator, which included a fresh `e2e init` iOS project on most Macs.
