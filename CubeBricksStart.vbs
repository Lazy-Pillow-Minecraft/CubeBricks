
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder

shell.Run "cmd.exe /c """ & folder & "\CubeBricksStart.bat""", 0, False
