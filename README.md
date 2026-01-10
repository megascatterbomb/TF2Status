# TF2 Server Status Bot for Discord

This bot lets you and your community monitor the activity your TF2 servers via Discord, connect to them easily, and ping when there's activity.

## Features

- No sourcemod plugins required! Works with any TF2 server!
- Instant connect links that boot up the user's steam client, game, and connects them to the server with just one click.
- Shows when a server is full, password protected, or goes down.
- Public facing web-page that lists all your servers, plus any external links you wish!
- Use the public API to power your own site.
- Full support for Steam-networked servers when using a Steam API key and GSLT.
- Full support for TF2 sourcemods like [TF2 Classified](https://store.steampowered.com/app/3545060/Team_Fortress_2_Classified/) or [TF2 Gold Rush](https://store.steampowered.com/app/3826520/Team_Fortress_2_Gold_Rush/).
- Serve custom downloads with built-in FastDL capability.
- Logs queries, usage of instant connect links, and FastDL downloads.

This bot does **not**:

- Offer any rcon or sourcemod integration.
- Provide means of assigning Discord roles to users.
- Save or display long-term historical data.

## Installation and setup

### Requirements

- Infrastructure to host the bot with NodeJS with either a domain or dedicated IP and an open port.
- A discord server with dedicated channels to house your bot. The bot will edit the latest message in its channel, so you need to dedicate one channel per TF2 server. Recommended you create a separate category for your TF2 servers.
- If your TF2 server uses Steam Networking, you need to provide a Steam API Key and the Steam ID for your server. For the server's Steam ID to persist between reboots you need to register a GSLT for it.

### Example configuration

The first example server uses Steam networking and activity pings.

```json
{
    "discordToken": "MY_DISCORD_TOKEN",
    "websiteTitle": "megascatterbomb's servers",
    "interval": 1,
    "queriesPerInterval": 1,
    "pingCooldown": 120,
    "fastdlPath": "./temp",
    "steamApiKey": "MY_STEAM_API_KEY",
    "urlBase": "https://megascatterbomb.com",
    "publishSite": true,
    "webPort": 3001,
    "externalLinks": [
        {
            "title": "YouTube",
            "url": "https://www.youtube.com/@megascatterbomb",
            "description": "Tune in to weekly livestreams on the TF2 servers."
        },
        {
            "title": "Discord",
            "url": "https://discord.megascatterbomb.com",
            "description": "Join our Discord server for announcements, server activity pings, and to join the livestream stage chat."
        },
        {
            "title": "GitHub",
            "url": "https://github.com/megascatterbomb/TF2Status",
            "description": "See the source code behind this status page and the matching discord bot."
        }
    ],
    "servers": [
        {
            "description": "A 24/7 rotation server with nearly every official map.",
            "ip": "85568392932345578",
            "port": 27015,
            "appID": 440,
            "supportsDirectConnect": true,
            "urlPath": "bs",
            "channelID": "12345678901234567890",
            "pings": [
                {
                    "role": "12345678901234567890",
                    "threshold": 10
                },
                {
                    "role": "12345678901234567890",
                    "threshold": 20
                },
                {
                    "role": "12345678901234567890",
                    "threshold": 30
                },
                {
                    "role": "12345678901234567890",
                    "threshold": 40
                }
            ]
        },
        {
            "description": "kiwi's stupid doublecross server",
            "ip": "51.161.153.190",
            "port": 27015,
            "appID": 440,
            "supportsDirectConnect": true,
            "urlPath": "kiwi",
            "connectString": "example.com",
            "channelID": "12345678901234567890",
            "pings": []
        }
    ]
}
```

### Settings

#### `discordToken`
The discord token for your discord bot. Get one here TODO

#### `websiteTitle`
The title of the website. Displays both in the browser tab and at the top of the page.

#### `interval`
In minutes, what's the maximum interval between two queries to a given TF2 server?

#### `queriesPerInterval`
What's the maximum amount of queries per interval per TF2 server? The bot will query this many times per interval, but will only show one query per interval in the discord embed. Other queries are skipped if the server has no players or the server has failed to respond 2+ times, reducing the total amount of unnecessary queries. The website and the "NOW:" row in the discord embed always show the latest information.

Not recommended to set this to a value higher than 6 as you'll start hitting ratelimits for discord and use up more Steam API queries for Steam-networked servers. Larger providers should set this to 1.

#### `pingCooldown`
In minutes, the minimum time between any role being pinged twice for the same server. Once this time has elapsed, the bot will reset the ping if the playercount has dropped significantly below its triggering threshold (e.g. a 20 player ping will only reset if the server drops to 17 players or less).

#### `fastdlPath` (optional)
The path at which the game will look for files to serve to connecting players. Whichever folder you specify here should have folders inside it for maps, materials, sounds, etc.

#### `steamApiKey` (required for Steam Networking only)
Used to query Steam Networking based servers, both to fetch the IP address from Steam with `IGameServersService/GetServerIPsBySteamID`, and to query the server directly with `IGameServersService/QueryByFakeIP`. Get an API key here: TODO

#### `urlBase`
The base URL to prepend any links and such with. Include the `http://` or `https://` at the front. For example, I set `https://megascatterbomb.com` which means my server's connect link will be `https://megascatterbomb.com/tf2/bs`.

#### `publishSite`
Set to `true` or `false`, determines if a webpage will be served at the root URL. If you have your own site you should set this to false and redirect any requests to `/tf2` and `/api` to this bot.

#### `webPort`
The port your website and API is served on.

#### `externalLinks`
An array of JSON objects defining what external links are printed at the bottom of the website. The links are displayed in the order they are defined in the config file. The properties of an external link object are as follows

- `title`: The title of the link, displayed inside a clickable button which opens the link.
- `url`: The URL that is opened when the button is clicked. Links always open in a new tab.
- `description`: Text that is displayed alongside the button.

#### `servers`
An array of JSON objects defining the configuration for each of your TF2 servers. The servers are listed on the site in the same order they are defined in the config file.

-  `description`: A text description of the server displayed next to the server name. The server name itself is pulled from the master server list and matches what's displayed in the server browser.
- `ip`: For conventional servers, this is the IP address of the server. For Steam Networking based servers, this is the persistent SteamID64 of the server. The SteamID64 will be used to obtain the fake IP address assigned by Steam at runtime. This should always be input as a string.
- `port`: The port the server is running on. Although not strictly necessary for Steam Networked servers, this is still a required variable in case future functionality depends on it.
- `appID`: The appID of the server. Use 440 for vanilla TF2. If your server is for a sourcemod like TF2 Classified, be sure to set the mod name below.
- `modName` (optional): The name of the sourcemod this server is for. If specified, a link to the mod's storepage will be provided using the configured appID.
- `supportsDirectConnect`: Set to `true` to enable the instant connect links. Set to `false` to disable them.
- `urlPath`: The alias for the server that will be used for instant connect links. Instant connect links follow the format `{baseURL}/tf2/{urlPath}`. Please note if you specify a server path that conflicts with a FastDL path, the server path will take priority, so don't use `maps`, `materials`, `custom` etc as server prefixes.
- `connectString` (optional): if provided, the console command that users can copy to manually connect will be replaced with this string, so if your connectString is `tf2example.com` then the bot will display `connect tf2example.com`. Steam Networked servers ignore this value.
- `channelID`: The discord channel id that the bot posts messages in. If the latest available message is from the same bot, it will edit that message (or delete and replace if pinging). Otherwise it will post a new message. This should always be input as a string.
- `pings`: A JSON array defining which roles the bot should ping and what player count those pings should trigger at.

The ping objects have this structure:
```
{
    "role": "12345678901234567890",
    "threshold": 10
}
```

