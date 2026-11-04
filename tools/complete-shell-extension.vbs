' Runs complete-shell-extension.cmd with no console window.
' The scheduled task points here so a post-update asar swap never flashes a terminal.
Option Explicit

Dim shell, fso, here, target
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(here, "complete-shell-extension.cmd")

If Not fso.FileExists(target) Then
  WScript.Quit 2
End If

' 0 = hidden window, False = do not wait for the child process.
shell.Run """" & target & """", 0, False
