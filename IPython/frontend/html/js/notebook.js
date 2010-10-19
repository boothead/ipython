$.ajaxSetup({
    url: client_id,
    dataType: "json"
})
$(document).ready(function() {
    heartbeat()
    comet = new CometGetter()
    manager = new Manager("messages")
    statusbar = new StatusBar("statusbar")
    //Startup POST, set some globals
    $.ajax({
        type: "POST",
        data: {type:"connect"},
        success: function(json, status, request) {
            username = json.parent_header.username
            session = json.header.session
            exec_count = json.content.execution_count
            manager.get().activate()
        }
    })
})

function xmlencode(string) {
    return string.replace(/\&/g,'&'+'amp;').replace(/</g,'&'+'lt;')
        .replace(/>/g,'&'+'gt;').replace(/\'/g,'&'+'apos;')
        .replace(/\"/g,'&'+'quot;');
}

attrib = {"30":"cblack", "31":"cred","32":"cgreen", "34":"cblue", "36":"ccyan", "01":"cbold"}
function fixConsole(txt) {
    //Fixes escaped console commands, IE colors. Turns them into HTML
    //Unfortunately, the "semantics" of html and console are very 
    //different, so fancy things *will* break
    txt = xmlencode(txt)
    var re = /\033\[([\d;]+?)m/
    var opened = false
    var cmds = []
    var opener = ""
    var closer = ""
    
    while (re.test(txt)) {
        var cmds = txt.match(re)[1].split(";")
        closer = opened?"</span>":""
        opened = cmds.length > 1 || cmds[0] != 0
        var rep = []
        for (var i in cmds)
            if (typeof(attrib[cmds[i]]) != "undefined")
                rep.push(attrib[cmds[i]])
        opener = rep.length > 0?"<span class=\""+rep.join(" ")+"\">":""
        txt = txt.replace(re, closer + opener)
    }
    if (opened) txt += "</span>"
    return txt.trim()
}

function inspect(obj) {
    if (obj instanceof Object) {
        var str = []
        for (var i in obj) 
            str.push(i+": "+inspect(obj[i]).replace("\n", "\n\t"))
        return "{\n\t"+str.join("\n\t")+"\n}\n"
    } else {
        try {
        return obj.toString()
        } catch (e) {
        }
        return ""
    }
}
