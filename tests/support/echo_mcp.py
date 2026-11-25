"""A tiny stdio MCP server for tests: `echo_path` reports the path it was given and the
directory it runs in; `big` returns more text than a model should be handed at once."""
import asyncio
import json
import os

from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, ListToolsResult, TextContent, Tool

TOOLS = [
    Tool(name="echo_path", description="Report a path argument and the working directory.",
         inputSchema={"type": "object", "properties": {"path": {"type": "string"}, "note": {"type": "string"}}}),
    Tool(name="big", description="Return a very long text.", inputSchema={"type": "object", "properties": {}}),
]


async def list_tools(_context, _params):
    return ListToolsResult(tools=TOOLS)


async def call_tool(_context, params):
    if params.name == "big":
        text = "x" * 200_000
    else:
        text = json.dumps({"given": params.arguments, "cwd": os.getcwd()})
    return CallToolResult(content=[TextContent(type="text", text=text)], isError=False)


async def main():
    server = Server("echo", version="0", on_list_tools=list_tools, on_call_tool=call_tool)
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
