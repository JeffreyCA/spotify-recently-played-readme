import { Image, Typography } from 'antd';
import SpotifyIcon from '../../public/spotify.svg';

const { Text } = Typography;

interface Props {
    /**
     * Username.
     */
    username: string;
}

/**
 * Track list header component.
 */
export default function TrackListHeader(props: Props): JSX.Element {
    return (
        <span>
            <a target="_blank" rel="noopener noreferrer" href={`https://open.spotify.com/user/${props.username}`}>
                <Image className="spotify-icon" src={SpotifyIcon} width={100}></Image>
            </a>
            <Text className="spotify-title">Recently Played</Text>
        </span>
    );
}
