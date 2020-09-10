const fs = require("fs").promises;
const tmp = require("tmp-promise");
const ffmpeg = require('fluent-ffmpeg');
//const talks = require("../../github.com/machine-learning-workshop/_data/talks.json").reduce((acc, obj) => Object.assign(acc, obj), {});

// required for pdfjs :/
const assert = require("assert");

// from https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.js#L20
function NodeCanvasFactory() {}
NodeCanvasFactory.prototype = {
  create: function NodeCanvasFactory_create(width, height) {
    var Canvas = require("canvas");

    assert(width > 0 && height > 0, "Invalid canvas size");
    var canvas = Canvas.createCanvas(width, height);
    var context = canvas.getContext("2d");
    return {
      canvas: canvas,
      context: context,
    };
  },

  reset: function NodeCanvasFactory_reset(canvasAndContext, width, height) {
    assert(canvasAndContext.canvas, "Canvas is not specified");
    assert(width > 0 && height > 0, "Invalid canvas size");
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },

  destroy: function NodeCanvasFactory_destroy(canvasAndContext) {
    assert(canvasAndContext.canvas, "Canvas is not specified");

    // Zeroing the width and height cause Firefox to release graphics
    // resources immediately, which can greatly reduce memory consumption.
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  },
};

function serializeTimestamp(seconds) {
  const ms = ("" + (seconds - Math.floor(seconds)).toFixed(3)*1000).padEnd(3, "0");
  let h = 0, m = 0, s = 0;
  if (seconds >= 3600) {
    h = Math.floor(seconds/3600);
  }
  m = Math.floor((seconds - 3600*h) / 60);
  s = Math.floor(seconds - 3600*h - 60*m);
  return (h? h + ":" : "") + ("" + m).padStart(2, "0") + ":" + ("" + s).padStart(2, "0") + (ms ? "." + ms : "");
}

function ffmpegWrapper(command, output) {
  return new Promise((res, rej) => command
                     .on("start", cli => console.log('Spawned Ffmpeg with command: ' + cli))
                     .on("progress", progress => console.info(`Processing at ${progress.currentFps} fps - currently at ${progress.timemark}`))
                     .on("error", err => rej(err))
                     .on("end", () => res(output))
                     .save(output));
}

async function getVideoDuration(videoPath) {
  return new Promise((res, rej) => ffmpeg.ffprobe(videoPath, (err, metadata) => {
    if (err) return rej(err);
    res(metadata.streams[0].duration);
  }));
}

async function getSlidesTransitionsFromText(textPath) {
  const lines = await fs.readFile(textPath, 'utf-8').split("\n");
  const {cues} = parser.parse(await fs.readFile(captionPath, 'utf-8'))
  const transitions = [];
  lines.forEach(l => {
    transitions.push({start: l.split(" ")[0], slideNum: parseInt(l.split(" ")[1], 10)});
  });
  if (!transitions.length) throw new Error("No slides transition identified");
  return transitions;
}

async function getSlidesTransitionsFromCaptions(captionPath) {
  const WebVTTParser = require("webvtt-parser").WebVTTParser;
  const parser = new WebVTTParser();

  const {cues} = parser.parse(await fs.readFile(captionPath, 'utf-8'))

  let slideNum = 1;
  const transitions = [];
  cues.forEach(c => {
    if (c.id.startsWith("slide-" + slideNum)) {
      transitions.push({start: c.startTime, slideNum});
      // TODO do not enforce monotonicity of slide increase?
      slideNum++;
    }
  });
  if (!transitions.length) throw new Error("No slides transition identified");
  return transitions;
}

async function generateSlideImages(pdfPath, height, tmpdir) {
  const pdfjsLib = require("pdfjs-dist/es5/build/pdf.js");

  const data = new Uint8Array(await fs.readFile(pdfPath));
  var loadingTask = pdfjsLib.getDocument({
    data: data
  });
  return loadingTask.promise
    .then(pdfDocument => {
      return Promise.all([...Array(pdfDocument.numPages).keys()].map(pageNumber => {
        pdfDocument.getPage(pageNumber + 1).then(function(page) {
          // Make slides fit the available space (Note the need to convert from
          // CSS points to CSS pixels for page dimensions)
          const scale = (height / page.view[3]);
          const viewport = page.getViewport({ scale });
          // from https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.js#L76
          const canvasFactory = new NodeCanvasFactory();
          const canvasAndContext = canvasFactory.create(
            viewport.width,
            viewport.height
          );
          const renderContext = {
            canvasContext: canvasAndContext.context,
            viewport: viewport,
            canvasFactory: canvasFactory,
          };

          const renderTask = page.render(renderContext);
          return renderTask.promise.then(function () {
            // Convert the canvas to an image buffer.
            var image = canvasAndContext.canvas.toBuffer();
            return fs.writeFile(tmpdir + "/slide-" + pageNumber + ".png", image).then(() => console.log("Converted slide " + pageNumber + " from PDF file to a PNG image."));
          });
        });
      }));
    });
}

async function generateSlideVideo(slidePath, height, transitions, duration, tmpdir) {
  // TODO check that all the slides referenced in transitions exist
  await generateSlideImages(slidePath, height, tmpdir);
  console.log(JSON.stringify(transitions, null, 2), duration);
  for (let i = 0 ; i < transitions.length ; i++) {
    let {start, slideNum} = transitions[i];
    let slideDur = 0;
    // We force the starting point for the first slide to be 0
    if (i === 0) start = 0;
    let to;
    if (transitions[i + 1]) {
      to = transitions[i + 1].start;
    } else {
      to = duration;
    }
    const command = ffmpeg(tmpdir + "/slide-" + (slideNum - 1) + ".png").inputOptions([
      "-f", "image2",
      "-loop 1",
      "-framerate 1",
      "-pattern_type none",
      "-r 1",
      "-t " + (to - start),
      "-vcodec png",
      "-an",
    ]);
    await ffmpegWrapper(command, tmpdir + '/slide-' + slideNum + '.mov');
  }
  const command = ffmpeg();
  let start, slideNum;
  for ({start, slideNum} of transitions) {
    command.input(tmpdir + "/slide-" + slideNum + ".mov")
  }
  return new Promise((res, rej) =>
                     command
                     .on('start', cli => console.log('Spawned Ffmpeg with command: ' + cli))
                     .on('error', rej)
                     .on('end', () => res(tmpdir + "/slides.mov"))
                     .mergeToFile(tmpdir + "/slides.mov")
                    )
}

async function generateAudioVideo(slidePath, videoPath, tmpdir) {
  const command = ffmpeg()
        .input(slidePath)
        .input(videoPath)
        .inputOption(["-vn"])
        .outputOptions([
          '-pix_fmt yuv420p',
          '-r 30000/1001',
          '-tune stillimage'
        ]);
  return ffmpegWrapper(command, tmpdir + '/slides.mp4');
}

/* ffmpeg -i <videoPath> -i <slidePath> -filter_complex "[1] fps=30000/1001 [slides]; scale=-1:360 [pip]; [slides][pip] overlay=main_w-overlay_w-10:main_h-overlay_h-10" -pix_fmt yuv420p -r 30000/1001 -tune stillimage <tmpDir/content.mp4> */
async function generatePipVideo(slidePath, videoPath, height, tmpdir) {
  const command = ffmpeg()
        .input(slidePath)
        .input(videoPath)
        .complexFilter(
          [
            "pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=30000/1001[slides]",
            {
              filter: 'scale', options: '-1:' + height / 4,
              outputs: 'pip'
            },
            {
              inputs: ['slides', 'pip'],
              filter: 'overlay', options: 'main_w-overlay_w-10:main_h-overlay_h-10'
            }
          ])
        .outputOptions([
          '-pix_fmt yuv420p',
          '-r 30000/1001',
          '-tune stillimage'
        ]);
  return ffmpegWrapper(command, tmpdir + '/pip.mp4');
}

async function concatVideos(output, fadeDuration, ...videos) {
  const command = ffmpeg();
  let filtercomplex = [], concat="";
  for (let i in videos) {
    const video = videos[i];
    command.input(video.path);
    // TODO make scale dependent on parameters
    filtercomplex.push(`[${i}:v]scale=1280x720,` + (i > 0 ? `fade=type=in:duration=${fadeDuration},` : '') + (i < videos.length - 1 ? `fade=type=out:duration=${fadeDuration}:start_time=${video.duration - fadeDuration},`: '') + `setpts=PTS-STARTPTS[v${i}]`);
    concat += `[v${i}][${i}:a]`;
  }
  filtercomplex.push(concat + `concat=n=${videos.length}:v=1:a=1[v][a]`)
  command.complexFilter(filtercomplex, ["v", "a"]);
  return ffmpegWrapper(command, output);
}

async function process({captionPath, transitionsPath, videoPath, slidePath, outputPath, height, audioonly, introPath, outroPath}) {
  const {path: tmpdir} = await tmp.dir();
  const transitions = captionPath ? await getSlidesTransitionsFromCaptions(captionPath) : getSlidesTransitionsFromText(transitionsPath);
  // TODO check that transitions start are monotically increasing
  const duration = await getVideoDuration(videoPath);
  const slideVideoPath = await generateSlideVideo(slidePath, height, transitions, duration, tmpdir);
  let contentVid;
  if (audioonly) {
    contentVideoPath = await generateAudioVideo(slideVideoPath, videoPath, tmpdir);
  } else {
    contentVideoPath = await generatePipVideo(slideVideoPath, videoPath, height, tmpdir);
  }
  if (introPath || outroPath) {
    const videos = await Promise.all([introPath, contentVideoPath, outroPath].filter(x => x)
                                     .map(async (path) => {
                                       const duration = await getVideoDuration(path);
                                       return {path, duration};
                                     }));
    // TODO do this at the same time as the PIP to avoid processing the same video multiple times?
    // TODO make fade duration an argument and a command line parameter
    return concatVideos(outputPath, 1, ...videos);
  } else {
    return fs.copyFile(contentVideoPath, outputPath);
  }
}

async function cli() {
  const argv = require('yargs')
        .option('captions', {
          alias: 'c',
          describe: 'path to the WebVTT captions file annotated with slides transitions'
        })
        .option('transitions', {
          alias: 't',
          describe: 'path to a text file listing slide transitions (one line per transition, space-separated time in second and slide number per line)'
        })
        .option('video', {
          alias: 'v',
          describe: 'path to the main video file'
        })
        .option('intro', {
          describe: 'path to the intro video file'
        })
        .option('outro', {
          describe: 'path to the outro video file'
        })
        .option('height', {
          alias: 'h',
          describe: 'height of the output video',
          default: 720
        })
        .option('audioonly', {
          describe: 'only imports audio from the main video file, do not PiP its video content',
          default: false,
          type: 'boolean'
        })
        .option('slides', {
          alias: 's',
          describe: 'path to the slides'
        })
        .option('output', {
          alias: 'o',
          describe: 'path where to generate the final video'
        })
        .demandOption(['video', 'slides', 'output'], '')
        .check(argv =>  {
          const paths = ["video", "slides"];
          if (!argv.captions && !argv.transitions) {
            throw new Error("Either captions or transitions need to be set");
          } else if (argv.captions && argv.transitions) {
            throw new Error("Only one of captions or transitions can be set");
          }
          if (argv.captions) paths.push("captions");
          if (argv.transitions) paths.push("transitions");
          if (argv.intro) paths.push("intro");
          if (argv.intro) paths.push("intro");
          if (argv.outro) paths.push("outro");
          const fs = require("fs");
          for (let p of paths) {
            if (!fs.statSync(argv[p])) {
              throw new Error("File " + argv[p] + " does not exist");
            }
          }
          // TODO check that `output` can be created
          /*if (!fs.accessSync(argv.output, "w")) {
            throw new Error("File " + argv.output + " is not writable");
          }*/
          return true;
        })
        .help()
        .argv;
  return process({captionPath: argv.captions, videoPath: argv.video, slidePath: argv.slides, outputPath: argv.output, height: argv.height, audioonly: argv.audioonly, introPath: argv.intro, outroPath: argv.outro});
}

/**************************************************
Code run if the code is run as a stand-alone module
**************************************************/
if (require.main === module) {
  cli().catch(e => {
    console.error(e);
    process.exit(64);
  });
}
