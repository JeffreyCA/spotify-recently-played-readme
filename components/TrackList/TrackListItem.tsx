import { Avatar, List, Typography } from 'antd';
import { PlayHistory } from '../../models/PlayHistory';
import Timestamp from './Timestamp';

const { Text } = Typography;

interface Props {
    /**
     * PlayHistory object.
     */
    playHistory: PlayHistory;
}

/**
 * Track list item component.
 */
export default function TrackListItem(props: Props): JSX.Element {
    const { playHistory } = props;
    const trackInfo = playHistory.track;
    // Join artists with comma
    const combinedArtistName = trackInfo.artists.map((artist) => artist.name).join(', ');
    const trackName = trackInfo.name;
    const trackUrl = trackInfo.external_urls.spotify;

    const albumName = trackInfo.album.name;
    const albumUrl = trackInfo.album.external_urls.spotify;
    const albumCoverSrc = trackInfo.inlineimage;

    return (
        <List.Item className="track-item" extra={<Timestamp isoDate={playHistory.played_at} />}>
            <List.Item.Meta
                avatar={
                    <a target="_blank" rel="noopener noreferrer" href={albumUrl} title={albumName}>
                        <Avatar shape="square" src={albumCoverSrc} />
                    </a>
                }
                title={
                    <a
                        className="ellipsis-overflow a-spotify"
                        target="_blank"
                        rel="noopener noreferrer"
                        href={trackUrl}
                        title={trackName}>
                        {trackName}
                    </a>
                }
                description={
                    <Text className="ellipsis-overflow" type="secondary" title={combinedArtistName}>
                        {combinedArtistName}
                    </Text>
                }
            />
        </List.Item>
    );
}
