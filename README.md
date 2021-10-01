# Spotify Recently Played README
Display your recently played Spotify tracks on your GitHub profile README. Powered by [Vercel](https://vercel.com).

> Check out [lastfm-recently-played-readme](https://github.com/JeffreyCA/lastfm-recently-played-readme) for a similar integration for Last.fm scrobbles.

## Getting Started
Click the button below to connect your Spotify account with the Vercel app. This is needed to access your recently played tracks.

> By authorizing the app, you agree to have your Spotify username, access token, and refresh token stored on a secure Firebase database. This is required so you only need to authorize once and the app can automatically refresh access tokens in order to retrieve recent tracks.
>
> You can revoke the app at https://www.spotify.com/account/apps.

<a href="https://spotify-recently-played-readme.vercel.app/"><img src="assets/auth.png" alt="Authorize button" width="160"/></a>

After granting permission, just add the following into your README and set the `user` query parameter to your Spotify username.

```md
![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16)
```

![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16)

### Link to Spotify profile
Use the following snippet to make the widget link to your Spotify profile (or any other URL).

```md
[![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16)](https://open.spotify.com/user/jeffreyca16)
```

[![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16)](https://open.spotify.com/user/jeffreyca16)

### Custom track count
To a custom number of tracks, pass the query parameter `count` and set it to the number of tracks to display.

> Default: `5`  
> Min: `1`  
> Max: `10`

Example:
```md
![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16&count=1)
```

![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16&count=1)

### Custom card width
To set a custom card width, pass the query parameter `width` and set it to the desired width in px.

> Default: `400`  
> Min: `300`  
> Max: `1000`

Example:
```md
![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16&width=600)
```

![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16&width=600)

### Unique tracks
To show only unique tracks of the recently played list, pass the `unique` query parameter and set it to `true`, `1`, `on`, or `yes`.

> Default: `false`  

Example:
```md
![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16&unique=true)
```

![Spotify recently played](https://spotify-recently-played-readme.vercel.app/api?user=jeffreyca16&unique=true)

## Deploying own Vercel instance
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https%3A%2F%2Fgithub.com%2FJeffreyCA%2Fspotify-recently-played-readme&env=NEXT_PUBLIC_CLIENT_ID,NEXT_PUBLIC_BASE_URL,NEXT_PUBLIC_REDIRECT_URI,CLIENT_SECRET,FIREBASE_PROJECT_ID,FIREBASE_PRIVATE_KEY_B64,FIREBASE_CLIENT_EMAIL)

Deploy your own Vercel instance using the link above. Next, set the following environment variables:

| Name | Description |
|---|---|
| `NEXT_PUBLIC_REDIRECT_URI` | Callback URI from Spotify |
| `NEXT_PUBLIC_BASE_URL` | Base URL of the project |
| `NEXT_PUBLIC_CLIENT_ID` | Spotify app client ID |
| `CLIENT_SECRET` | Spotify app client secret key |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_PRIVATE_KEY_B64` | Base64-encoded string of Firebase private key |
| `FIREBASE_CLIENT_EMAIL` | Firebase client email |
| `FIREBASE_DATABASE_URL` | Firebase database URL |
| `WARMUP_KEY` | Secret to trigger Firebase database warmup (see [Common issues](#common-issues) for more info)

Finally, edit `utils/Constants.ts` and set the `ClientId`, `BaseUrl`, `RedirectUri` values.

## Running locally
1. Clone Git repo
    ```sh
    $ git clone https://github.com/JeffreyCA/spotify-recently-played-readme.git
    ```
2. Install Node dependencies
    ```sh
    $ npm install
    ```
3. Create `.env` file containing required environment variables:
    ```sh
    NEXT_PUBLIC_REDIRECT_URI=<Callback URI from Spotify>
    NEXT_PUBLIC_BASE_URL=<Base URL of the project>
    NEXT_PUBLIC_CLIENT_ID=<Spotify app client ID>
    CLIENT_SECRET=<Spotify app client secret key>
    FIREBASE_PROJECT_ID=<Firebase project ID>
    FIREBASE_PRIVATE_KEY_B64=<Base64-encoded string of Firebase private key>
    FIREBASE_CLIENT_EMAIL=<Firebase client email>
    FIREBASE_DATABASE_URL=<Firebase database URL>
    ```
4. Edit `utils/Constants.ts` and set the `ClientId`, `BaseUrl`, `RedirectUri` values.
5. Run development server
    ```sh
    $ npm run dev
    ```

The app will be running at [http://localhost:3000](http://localhost:3000).

## Common issues
### Widget fails to load on GitHub
Sometimes you may encounter an issue where the widget fails to load on GitHub, with a 502 response from `camo.githubusercontent.com`. This is because GitHub proxies images and will timeout requests if they take too long. Long request times are usually a result of Firebase database **cold starts**, which can take up to several seconds ([known issue](https://issuetracker.google.com/issues/158014637)).

As a workaround, there's an endpoint at `/api/warmup?key=<WARMUP_KEY>` which accepts a GET request with a single query parameter `key`. If it matches the environment variable `WARMUP_KEY`, then it will go ahead and issue a simple database read request to Firebase to keep it *warm*. For your own Vercel instance, you can setup a simple cron job to ping the endpoint every few minutes or so to prevent cold starts. I already do this with the hosted Vercel instance.

This is a bit of a hacky workaround and may not 100% eliminate the issue. If you have any better solutions or have general optimizations feel free to create a PR!

## License
[MIT](LICENSE)
