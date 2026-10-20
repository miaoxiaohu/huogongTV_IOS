/**
 * The video player, as far as a test needs it: it reports how long the video
 * is, and draws nothing.
 */
const React = require("react");

function Video(props) {
    React.useEffect(() => {
        if (props.onLoad) {
            props.onLoad({
                duration: 100,
                currentTime: 0,
                naturalSize: { width: 1080, height: 1920 },
            });
        }
    }, []);
    return null;
}

module.exports = {
    __esModule: true,
    default: Video,
};
