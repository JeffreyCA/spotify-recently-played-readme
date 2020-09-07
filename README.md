# Spotify Recently Played README
Display your recently played Spotify tracks on your GitHub profile README. Powered by [Vercel](https://vercel.com).

> Check out [lastfm-recently-played-readme](https://github.com/JeffreyCA/lastfm-recently-played-readme) for a similar integration for Last.fm scrobbles.

## Getting Started
Click the button below to connect your Spotify account with the Vercel app. This is needed to access your recently played tracks.

> By authorizing the app, you agree to have your Spotify username, access token, and refresh token stored on a secure Firebase database. This is required so you only need to authorize once and the app can automatically refresh access tokens in order to retrieve recent tracks.
>
> You can revoke the app at https://www.spotify.com/account/apps.

[![Authorize app](assets/auth.png)](https://spotify-recently-played-readme.vercel.app/)

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

## Deploying own Vercel instance
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/git/external?repository-url=https%3A%2F%2Fgithub.com%2FJeffreyCA%2Fspotify-recently-played-readme&env=CLIENT_ID,CLIENT_SECRET,FIREBASE_PROJECT_ID,FIREBASE_PRIVATE_KEY_B64,FIREBASE_CLIENT_EMAIL)

Deploy your own Vercel instance using the link above. Next, set the following environment variables:

| Name | Description |
|---|---|
| `CLIENT_ID` | Spotify app client ID |
| `CLIENT_SECRET` | Spotify app client secret key |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_PRIVATE_KEY_B64` | Base64-encoded string of Firebase private key |
| `FIREBASE_CLIENT_EMAIL` | Firebase client email |
| `FIREBASE_DATABASE_URL` | Firebase database URL |

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
    CLIENT_ID=<Spotify app client ID>
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

## License
[MIT](LICENSE)
