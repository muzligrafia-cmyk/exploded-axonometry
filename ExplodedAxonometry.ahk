#Requires AutoHotkey v2.0
#SingleInstance Force

; F9 in Illustrator -> runs ExplodedAxonometry.jsx
; Keep ExplodedAxonometry.jsx in the SAME folder as this file
; (or change the path below).
;
; Talks to Illustrator directly (COM), the same way as RearrangeArtboards.ahk:
; no Illustrator Action involved, and no "You're about to run the script..." warning.
ScriptPath := A_ScriptDir "\ExplodedAxonometry.jsx"

#HotIf WinActive("ahk_exe Illustrator.exe")
F9:: {
    if !FileExist(ScriptPath) {
        MsgBox "Can't find ExplodedAxonometry.jsx here:`n" ScriptPath
        return
    }
    ai := ""
    try {
        ai := ComObjActive("Illustrator.Application")
    } catch {
        try {
            ai := ComObject("Illustrator.Application")
        } catch {
            MsgBox "Couldn't connect to Illustrator."
            return
        }
    }
    try {
        ai.DoJavaScriptFile(ScriptPath)
    } catch as err {
        MsgBox "Illustrator couldn't run the script:`n" err.Message
    }
}
#HotIf
