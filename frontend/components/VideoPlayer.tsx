'use client';

import React, { useRef, forwardRef, useImperativeHandle, useState, useEffect } from 'react';

interface VideoPlayerProps {
    url: string | null;
}

export interface VideoPlayerRef {
    seekTo: (seconds: number) => void;
}

// Using native HTML5 video element instead of react-player due to React 19 compatibility issues
const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(({ url }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);

    useImperativeHandle(ref, () => ({
        seekTo: (seconds: number) => {
            console.log("VideoPlayer: seekTo called with", seconds);

            if (videoRef.current) {
                videoRef.current.currentTime = seconds;
                videoRef.current.play().catch(err => {
                    console.warn("Autoplay blocked:", err);
                });
                setIsPlaying(true);
                console.log("VideoPlayer: Seek successful to", seconds);
            } else {
                console.warn("VideoPlayer error: videoRef is null");
            }
        }
    }), []);

    if (!url) {
        return (
            <div className="w-full h-96 bg-gray-900 flex items-center justify-center text-gray-400">
                No Video Selected
            </div>
        );
    }

    return (
        <div className="w-full h-full bg-black rounded-lg overflow-hidden shadow-xl">
            <video
                ref={videoRef}
                src={url}
                className="w-full h-full"
                controls
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
            />
        </div>
    );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
