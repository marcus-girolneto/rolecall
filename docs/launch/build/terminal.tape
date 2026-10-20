Output build/terminal.mp4
Set Shell zsh
Set FontSize 19
Set Width 1920
Set Height 1080
Set Padding 48
Set LineHeight 1.25
Set TypingSpeed 45ms
Set Theme { "name": "rolecall", "black": "#12131a", "red": "#ff6b6e", "green": "#3ddc97", "yellow": "#ffb020", "blue": "#8fb4ff", "magenta": "#c18cff", "cyan": "#7fd8e8", "white": "#d9dbe6", "brightBlack": "#7d8095", "brightRed": "#ff8a8c", "brightGreen": "#6be6b0", "brightYellow": "#ffc95c", "brightBlue": "#a9c6ff", "brightMagenta": "#d3abff", "brightCyan": "#a3e6f0", "brightWhite": "#ffffff", "background": "#0f1016", "foreground": "#e8e9f0", "selection": "#2a2c3a", "cursor": "#3ddc97" }

Hide
Type "setopt interactive_comments; cd examples/invoice-agent && export PATH=$PWD/node_modules/.bin:$PATH PS1='%F{8}invoice-agent%f $ ' && rm -rf .rolecall/runs && clear"
Enter
Sleep 500ms
Show

Type "# Who may do what, declared next to the agent:"
Sleep 600ms
Enter
Type "grep -A4 'permissions:' rolecall.suite.ts"
Sleep 400ms
Enter
Sleep 3.5s
Hide
Type "clear"
Enter
Show
Type "rolecall run"
Sleep 400ms
Enter
Sleep 9s

Hide
Type "export INVOICE_DEMO_FIXED=1 && clear"
Enter
Sleep 300ms
Show
Type "# After adding the permission check to refundInvoice:"
Sleep 600ms
Enter
Type "rolecall run"
Sleep 400ms
Enter
Sleep 6s
