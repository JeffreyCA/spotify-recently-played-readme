import axios from 'axios';
import { NextApiRequest, NextApiResponse } from 'next';
import PlaceholderImg from '../../public/placeholder.webp';
import * as Constants from '../../utils/Constants';
import { getTokensFromFirebase, writeTokensToFirebase } from '../../utils/FirebaseUtil';
import { getRecentlyPlayed, getUsername, isValidToken, refreshAccessToken } from '../../utils/SpotifyAuthUtil';
import { generateSvg } from '../../utils/SvgUtil';

/**
 * Main endpoint to return SVG.
 */
export default async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
    const { user } = req.query;
    if (!user || Array.isArray(user)) {
        res.statusCode = 400;
        res.json({ error: `Invalid 'user' parameter` });
        return;
    }

    // Parse 'width' query parameter
    const widthQuery: string | string[] | undefined = req.query['width'];
    let width = Constants.defaultWidth;

    if (typeof widthQuery === 'string') {
        width = parseInt(widthQuery);
    }
    if (!width || Array.isArray(width) || width < Constants.minWidth || width > Constants.maxWidth) {
        res.statusCode = 400;
        res.json({ error: `'width' parameter must be between ${Constants.minWidth} and ${Constants.maxWidth}` });
        return;
    }

    // Parse 'count' query parameter
    const countQuery: string | string[] | undefined = req.query['count'];
    let count = Constants.defaultCount;

    if (typeof countQuery === 'string') {
        count = parseInt(countQuery);
    }
    if (!count || Array.isArray(countQuery) || count < Constants.minCount || count > Constants.maxCount) {
        res.statusCode = 400;
        res.json({ error: `'count' parameter must be between ${Constants.minCount} and ${Constants.maxCount}` });
        return;
    }

    function parseBoolean(value: string) {
        switch (value) {
            case 'true':
            case '1':
            case 'on':
            case 'yes':
                return true;
            default:
                return false;
        }
    }
    const uniqueTrackQuery: string | string[] | undefined = req.query['unique'];
    let uniqueTrack = Constants.defaultUniqueTrack;
    if (typeof uniqueTrackQuery === 'string') {
        uniqueTrack = parseBoolean(uniqueTrackQuery);
    }

    try {
        // Retrieve access tokens from Firebase
        const tokens = await getTokensFromFirebase(user);
        if (!tokens.accessToken || !tokens.refreshToken) {
            // Tokens are missing, so redirect to home with error message
            res.redirect(`${Constants.BaseUrl}?error=Please authorize below.`);
            return;
        }

        // Check if token is valid
        const validToken = await isValidToken(tokens.accessToken);

        if (!validToken) {
            try {
                // Invalid token, so obtain new access token using refresh token
                const newAccessToken = await refreshAccessToken(tokens.refreshToken);
                tokens.accessToken = newAccessToken;
                // Write new access token to Firebase
                await writeTokensToFirebase(user, tokens.accessToken, tokens.refreshToken);
            } catch (e) {
                // Otherwise redirect user to re-authorize
                res.redirect(`${Constants.BaseUrl}?error=Please re-authorize below.`);
                return;
            }
        }

        // Get recently played tracks
        const username = await getUsername(tokens.accessToken);
        const limit = uniqueTrack ? Constants.defaultUniqueTrackSearchLimit : count
        let recentlyPlayedItems = await getRecentlyPlayed(limit, tokens.accessToken);

        if (uniqueTrack) {
            // Remove duplicate tracks...
            recentlyPlayedItems = recentlyPlayedItems.filter((v, i, a) => a.findIndex((t) => t.track.id === v.track.id) === i);
            // ... then only return the number of items that are requested.
            recentlyPlayedItems = recentlyPlayedItems.slice(0, count);
        }

        // Set base64-encoded cover art images by routing through /api/proxy endpoint
        // This is needed because GitHub's Content Security Policy prohibits external images (inline allowed)
        for (const { track } of recentlyPlayedItems) {
            try {
                // Image at index 2 *should be* the smallest image size
                const smallImg = track?.album.images[2].url;
                if (!smallImg) {
                    throw new Error();
                }

                const { data } = await axios.get<string>(`${Constants.BaseUrl}/api/proxy`, {
                    params: {
                        img: smallImg,
                    },
                });
                track.inlineimage = data;
            } catch {
                track.inlineimage = PlaceholderImg;
            }
        }

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
        res.setHeader('Content-Type', 'image/svg+xml');
        res.statusCode = 200;
        res.send(generateSvg(recentlyPlayedItems, username, width));
    } catch (e) {
        const data = e?.response?.data;
        res.statusCode = 400;
        if (data) {
            res.json({ error: data.message });
        } else {
            res.json({ error: e.toString() });
        }
    }
};
