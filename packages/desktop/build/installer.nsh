; Let companion screens (stage display, phone remote, OBS overlay) reach this
; machine. Without an inbound rule Windows Firewall silently refuses the
; connection and a phone on the same Wi-Fi just times out, which is the single
; most common reason those features appear not to work.
;
; The rule is scoped to remoteip=localsubnet, so only devices on the same
; network can connect - never the wider internet - and it is not tied to a
; firewall profile, so it keeps working whether Windows has decided the church
; Wi-Fi is Private or Public.
;
; This is best effort. A per-user install runs unelevated and netsh will fail,
; which is fine: the app detects that case and offers to add the rule itself
; from Settings, with a proper elevation prompt. Failing here must never block
; the install, so nothing is checked and nothing is reported.

!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Vifug companion screens"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Vifug companion screens" dir=in action=allow program="$INSTDIR\Vifug.exe" enable=yes profile=any remoteip=localsubnet'
!macroend

; Leaving a rule behind pointing at a deleted executable is untidy and confusing
; to anyone auditing their firewall later.
!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Vifug companion screens"'
!macroend
