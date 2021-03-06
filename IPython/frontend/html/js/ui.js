//Let's arbitrarily set the number of columns to 5
//We can eventually recompute the ideal width
columns = 5

/***********************************************************************
 * Tracks the status bar on the right, will eventually be draggable
 ***********************************************************************/
function StatusBar(obj) {
    this.text = $(document.createElement("span"))
    this.text.addClass("txt")
    $("#"+obj).append(this.text)
    this.bullet = $(document.createElement("span"))
    this.bullet.addClass("bullet")
    this.bullet.html("&#8226;")
    $("#"+obj).append(this.bullet)
}
StatusBar.prototype.map = { "idle":"cgreen", "busy":"cyellow", "dead":"cred" }
StatusBar.prototype.set = function(status) {
    this.bullet.removeClass()
    this.bullet.addClass("bullet "+this.map[status])
    this.text.text(status)
}

function History(obj) {
    this.obj = $("#"+obj)
    this.history = []
// History retrieval breaks the kernel still!
//    gethistory(-1)
}
History.prototype.append = function(hist) {
    for (var i in hist) {
        this.history.push(hist[i])
        var link = $(document.createElement("a"))
        link.attr("href", "javascript:kernhistory.click("+(this.history.length-1)+")")
        link.html(hist[i].replace(/\n/g, "<br />"))
        var obj = $(document.createElement("div")).addClass("item")
        obj.html($(document.createElement("p")).html("["+i+"]: "))
        this.obj.append(obj.append(link).append("<div class='clear'></div>"))
    }
    this.obj.scrollTo(this.obj.children().last())
}
History.prototype.click = function (id) {
    var msg = manager.get()
    msg.code = this.history[id]
    msg.activate()
}

/***********************************************************************
 * Manages the messages and their ordering
 ***********************************************************************/
function Manager(obj) {
    this.messages = {}
    this.ordering = []
    this.obj = "#"+obj
    this.ondeck = null
    this.cursor = 0
    var thisObj = this
    $(document).click(function() {
        thisObj.deactivate(thisObj.ondeck)
    })
    
    this.buf_out = null
}
Manager.prototype.get = function (msg_id) {
    if (typeof(msg_id) == "undefined") {
        //Handle manager.get(), to return a new message on deck
        if (this.ondeck == null) {
            this.ondeck = new Message(-1, this.obj)
            this.cursor = this.ordering.length
        }
        return this.ondeck
    } else if (msg_id[0] == "+" || msg_id[0] == "-") {
        //Handle the manager.get("+1") case, to advance the cursor
        var idx = parseInt(msg_id)
        if (this.cursor + idx <= this.ordering.length &&
            this.cursor + idx >= 0)
            this.cursor += idx
        if (this.cursor >= this.ordering.length ||
            this.ordering.length == 0) {
            return this.get()
        }
        return this.ordering[this.cursor]
    } else if (typeof(this.messages[msg_id]) == "undefined") {
        this.messages[msg_id] = new Message(msg_id, this.obj)
        this.ordering.push(this.messages[msg_id])
    }
    return this.messages[msg_id]
}
Manager.prototype.deactivate = function (current) {
    for (var i in this.messages)
        this.messages[i].deactivate()
    if (this.ondeck != null) {
        this.ondeck.deactivate()
        if (this.ondeck != current) { 
            this.ondeck.remove()
            this.ondeck = null
        }
    }
}
Manager.prototype.process = function (json, origin, immediate) {
    var id = json.parent_header.msg_id
    var type = json.msg_type
    
    //execute() calls always include an originating message
    //By this point, we know the correct ID for that message, so let's set it
    if (origin) {
        if (type != "execute_reply") 
            throw Exception("Received other message with an origin??")
        this.messages[id] = origin
        if (origin == this.ondeck) { 
            this.ordering.push(origin)
            this.ondeck = null
        }
    }
    
    //comet might have some buffered calls if it's paused, let's tacle first!
    while (comet.queue.length > 0)
        this.process(comet.queue.pop())
    
    var msg = this.get(id)
    if (type == "execute_reply") {
        exec_count = json.content.execution_count
        var data = null
        //If this reply has an SVG, let's add it
        if (json.content.payload.length > 0) {
            var payload = json.content.payload[0]
            if (typeof(payload['format']) != "undefined") {
                var format = payload['format']
                if (format == "svg") {
                    data = payload['data']
                    //Remove the doctype from the top, otherwise no way to embed
                    data = data.split("\n").slice(4).join("\n")
                } else if (format == "png") {
                    data = $(document.createElement("img"))
                    data.attr("src", "data:image/png;"+payload['data'])
                }
            } else if (typeof(payload["text"]) != "undefined") {
                data = fixConsole(payload["text"])
            }
            
        } else
            //Execute returned nothing, we need to flush in case of older messages
            msg.clearOutput()
        
        //Flush everything to output, including possible pyout/stream from pub
        var obj = $(document.createElement("div"))
        var head = typeof(this.buf_out) == "object" && this.buf_out != null
        if (this.buf_out != null) {
            obj.html(head?this.buf_out[0]:this.buf_out)
            obj.append("<br />")
            this.buf_out = null
        }
        msg.setOutput(obj.append(data), head)
        
        //Open a new input object
        manager.get().activate()
    } else if (type == "pyin") {
        if (json.content.code == "")
            msg.remove()
        else {
            var data = {}
            data[msg.num] = json.content.code
            msg.setInput(json.content.code, true)
            kernhistory.append(data)
        }
    } else {
        //If a message arrives, remove current ondeck and readd later
        var removed = false
        if (this.ondeck != null && this.ondeck.code == "") {
            this.ondeck.remove()
            removed = true
        }
        
        if (type == "stream") {
            this.buf_out = fixConsole(json.content.data)
        } else if (type == "pyout") {
            exec_count = json.content.execution_count
            msg.num = json.content.execution_count
            this.buf_out = [fixConsole(json.content.data)]
        } else if (type == "pyerr") {
            this.buf_out = fixConsole(json.content.traceback.join("\n"))
        }
        
        if (immediate) {
            var head = typeof(this.buf_out) == "object"
            msg.setOutput(head?this.buf_out[0]:this.buf_out, head )
            this.buf_out = null
        }
            
        if (removed) this.get().activate()
    }
    
    if (typeof(origin) != "undefined")
        origin.msg_id = id
}
Manager.prototype.length = function () {
    return this.ordering.length
}

/***********************************************************************
 * Each message is a paired input/output object
 ***********************************************************************/
function Message(msg_id, obj) {
    this.msg_id = msg_id
    this.num = msg_id == -1?exec_count+1:exec_count
    
    this.outer = $(document.createElement("div")).addClass("message")
    this.obj = $(document.createElement("div")).addClass("message_inside")
    $(obj).append(this.outer.append(this.obj))
    
    this.in_head = $(document.createElement("div")).addClass("input_header")
    this.in_head.html("In [<span class='cbold'>"+this.num+"</span>]:")
    this.obj.append(this.in_head)
    
    this.input = $(document.createElement("pre")).addClass("input")
    this.obj.append(this.input).append("<div class='clear'></div>")
    
    this.out_head = $(document.createElement("div")).addClass("output_header")
    this.obj.append(this.out_head)
    
    this.output = $(document.createElement("pre")).addClass("output")
    this.obj.append(this.output).append("<div class='clear'></div>")
    
    this.code = ""
    var thisObj = this
    this.obj.click(function(e) {
        thisObj.activate()
        e.stopPropagation()
        e.preventDefault()
    })
}
Message.prototype.activate = function () {
    manager.deactivate(this)
    this.outer.addClass("active")
    this.in_head.html("In [<span class='cbold'>"+(exec_count+1)+"</span>]:")
    this.text = new InputArea(this)
    $.scrollTo(this.outer)
}
Message.prototype.deactivate = function () {
    this.in_head.html("In [<span class='cbold'>"+this.num+"</span>]:")
    this.outer.removeClass("active")
    this.input.html(this.code)
}
Message.prototype.remove = function () {
    this.outer.remove()
    if (manager.ondeck == this)
        manager.ondeck = null
}
Message.prototype.setInput = function(value, header) {
    this.code = value
    this.input.html(value)
}
Message.prototype.setOutput = function(value, header) {
    //Add some flair, animate the output filling
    var obj = $(document.createElement("pre")).css(
        {opacity:0, position:"absolute"})
    $(document.body).append(obj.html(value))
    var h = obj.height()
    $(document.body).remove(obj)
    
    this.output.height(this.output.height())
    this.output.html(value)
    
    var thisObj = this
    this.output.animate({opacity:1, height:h}, {duration:200, complete:
        function () { thisObj.output.attr("style", null); 
            if (manager.ondeck != null)
               $.scrollTo(manager.ondeck.outer) }
    })
    
    var head = header?"Out [<span class='cbold'>"+this.num+"</span>]:":""
    this.out_head.html(head)
}
Message.prototype.clearOutput = function () {
    this.output.html("")
}

/***********************************************************************
 * Handles python input, submission, etc
 ***********************************************************************/
function InputArea(msg) {
    this.ilevel = 0
    this.msg = msg
    this.activate()
}
InputArea.prototype.activate = function () {
    this.text = $(document.createElement("textarea")).val(this.msg.code)
    this.text.addClass("inputText").attr("rows", 1)
    this.msg.input.html(this.text.attr("spellcheck", "false"))
    this.lh = this.text.height()
    this.nlines = this.msg.code.split("\n").length
    this.text.height(this.lh*this.nlines)
    this.update()
    
    var thisObj = this
    this.text.keydown(function (e) {thisObj.keyfunc(e)})
    this.text.keyup(function (e) {
        thisObj.msg.code = e.target.value
        thisObj.update() 
    })
    
    this.text.focus()
}
InputArea.prototype.keyfunc = function (e) {
    if (this.nlines > 1) {
        if (e.which == 13) {
            if (e.shiftKey)
                this.submit(e.target.value)
            else {
                this.insert("\n")
                e.preventDefault()
            }
            this.update(1)
        } 
    } else {
        if (e.which == 13) {
            if (e.ctrlKey) {
                this.insert("\n")
                this.update(1)
            } else
                this.submit(e.target.value)
        } else if (e.which == 38) {
            manager.get("-1").activate()
        } else if (e.which == 40) {
            manager.get("+1").activate()
        } else if (e.which == 9) {
            e.preventDefault()
            var thisObj = this
            var pos = this.text.getSelection().end
            tabcomplete(this.text.val(), pos, 
                function(matches) {thisObj.complete(matches)}
            )
        }
    }
}
InputArea.prototype.update = function (nlines) {
    //Updates line height for multi-line input
    var nnlines = this.msg.code.split("\n").length+(nlines?nlines:0)
    if (nnlines != this.nlines) {
        this.text.animate({height: this.lh*nnlines }, 50)
        this.indent(this.nlines > nnlines?-1:null)
    }
    this.nlines = nnlines
    var code = this.text.val().slice(0,this.text.getSelection().end)
}
InputArea.prototype.submit = function (code) {
    //Submits to the server, or removes the message if empty
    this.msg.code = code
    if (code == "")
        this.msg.remove()
    else {
        this.msg.input.html(code)
        execute(code, this.msg)
    }
}
InputArea.prototype.complete = function (matches) {
    //Callback function to enable tabcomplete
    if (matches.length == 1)
        this.replace(matches[0])
    else if (matches.length > 1) {
        var pos = this.text.getSelection().end
        this.selector = new Selector(this, matches)
        var thisObj = this
        Selector.prototype.set = function (match) {
            thisObj.replace(match, pos)
            this.remove()
        }
    }
}
InputArea.prototype.replace = function (match, pos) {
    //Replaces the matched word in a position, for tabcomplete
    if (typeof(pos) == "undefined")
        pos = this.text.getSelection().end
    var code = this.text.val()
    var words = code.slice(0,pos).split(' ')
    var end = code.slice(pos)
    words[words.length-1] = match
    if (end.length > 0)
        words.push(end)
    this.msg.code = words.join(' ')
    this.text.val(this.msg.code)
}
InputArea.prototype.indent = function (dedent) {
    //An attempt to make an autoindenter
    var code = this.text.val()
    var pos = this.text.getSelection().end
    
    this.ilevel += dedent?dedent:checkIndent(code, pos)
    this.ilevel = this.ilevel < 0?0:this.ilevel
    
    var tabs = ""
    for (var i = 0; i < this.ilevel; i++)
        tabs += "    "
    
    this.insert(tabs)
}
InputArea.prototype.insert = function (txt) {
    var pos = this.text.getSelection().end
    var code = this.text.val().slice(0,pos)+txt+this.text.val().slice(pos)
    this.text.val(code).setCursor(pos+txt.length)
}


/***********************************************************************
 * Fancy tabcomplete selector 
 ***********************************************************************/
function Selector(parent, matches) {
    this.parent = parent
    this.dialog = $(document.createElement("div"))
    this.dialog.addClass("completer")
    this.selectors = []
    this.cursor = 0
    
    this.pc = Math.ceil(matches.length / columns)
    for (var i = 0; i < columns; i++) {
        var column = $(document.createElement("div"))
        column.addClass("column")
        this.dialog.append(column)
        for (var j = 0; j < this.pc && i*this.pc+j < matches.length; j++) {
            var obj = new Selection(this, matches[i*this.pc+j], i*this.pc+j)
            this.selectors.push(obj)
            column.append(obj.obj)
            obj.init()
        }
    }
    
    var pos = this.parent.text.offset()
    pos.top += this.parent.text.height()
    this.dialog.offset(pos)
    $(document.body).append(this.dialog)
    this.selectors[this.cursor].active()
    $.scrollTo(this.selectors[this.cursor].obj)
    
    var thisObj = this
    this.parent.text.unbind('keydown')
    this.parent.text.keydown(function (e) {
        var f = function () { e.preventDefault(); e.stopPropagation() }
        if (e.which == 37) {
            thisObj.next("-"); f()
        } else if (e.which == 38) {
            thisObj.next(-1); f()
        } else if (e.which == 39) {
            thisObj.next("+"); f()
        } else if (e.which == 40 || e.which == 9) {
            thisObj.next(1); f()
        } else if (e.which == 27) {
            thisObj.remove(); f()
        } else if (e.which == 13) {
            thisObj.set(thisObj.selectors[thisObj.cursor].match); f()
        } //Perhaps implement vim keys?
    })
    $(document).click(function (e){
        thisObj.remove();
    })
}
Selector.prototype.deselect = function () {
    for (var i in this.selectors)
        this.selectors[i].clear()
}
Selector.prototype.next = function (n) {
    if (n[0] == "+") {
        this.cursor += this.pc
    } else if (n[0] == "-") {
        this.cursor -= this.pc
    } else {
        this.cursor += n
    }
    this.cursor = mod(this.cursor, this.selectors.length)
    this.selectors[this.cursor].active()
}
Selector.prototype.remove = function () {
    this.dialog.remove()
    var parent = this.parent
    this.parent.text.unbind('keydown')
    this.parent.text.keydown(function (e) {parent.keyfunc(e)})
    this.parent.text.focus()
}


function Selection(parent, match, idx) {
    this.idx = idx
    this.parent = parent
    this.obj = $(document.createElement("div"))
    this.obj.addClass("selection")
    this.obj.html(match)
    this.match = match
}
Selection.prototype.init = function () {
    var thisObj = this
    this.obj.mouseover(function(e) { thisObj.active(); })
    this.obj.click(function (e) { 
        thisObj.parent.set(thisObj.match);
        thisObj.parent.remove()
        e.stopPropagation() 
    })
}
Selection.prototype.active = function () {
    this.parent.deselect()
    this.parent.cursor = this.idx
    this.obj.addClass("selected")
}
Selection.prototype.clear = function () {
    this.obj.removeClass("selected")
}
