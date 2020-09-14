# presentation-composer.js

This tool takes slides (in PDF or HTML), a list of timed slide transitions, and a video file and creates a new video that overlays as picture-in-picture the original video on top of the slides.

The transitions are given a text file with on each line a number of seconds and a slide number (space separated).

Alternatively, the transitions can be read from a WebVTT caption files where a given transition is tied to a cue id of the form `slide-*n*`, as used in the [presentation-viewer](https://github.com/w3c/presentation-viewer/).

Optionally, it adds an intro video and/or an outro video at the beginning and the end of the final video, with a fade-in/fade-out effect.

This can be used to build a similar effect for audio-only recordings (without picture-in-picture overlay in this case).

## Command Line
```sh
node presentation-composer.js  --help
Options:
      --version      Show version number                               [boolean]
  -c, --captions     path to the WebVTT captions file annotated with slides
                     transitions
  -t, --transitions  path to a text file listing slide transitions (one line per
                     transition, space-separated time in second and slide number
                     per line)
  -v, --video        path to the main video file                      [required]
      --intro        path to the intro video file
      --outro        path to the outro video file
  -h, --height       height of the output video                   [default: 720]
      --audioonly    only imports audio from the main video file, do not PiP its
                     video content                    [boolean] [default: false]
  -s, --slides       path to the slides                               [required]
      --slideformat  Format of the slides - one of "pdf" or "url"
                                                                [default: "pdf"]
  -o, --output       path where to generate the final video           [required]
      --help         Show help                                         [boolean]
```

## What problem does it solve?
* it is not always practical to be recording both the slides and the speaker at a physical event, and often, recording the slides will deteriorate their readability. For static slides, this allows to focus on recording the speaker and generate a single video afterwards

* the [presentation-viewer](https://github.com/w3c/presentation-viewer/) is built on the assumption of keeping slides and video distinct to enable a more flexible way of consuming a presentation; but to share the presentation on video-only platforms, it is useful to be able to package the presentation as a single video, which this tool enables.

## Credits

Most of the hard work is done by ffmpeg, as wrapped by [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg).

This tool is very heavily inspired by [superimposer](https://github.com/jonhoo/superimposer/) which does most of the same in Python.