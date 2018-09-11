// Copyright (c) 2019 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

const fs = require('fs');
const path = require('path');

import {generateTrajectoryFrame, getPoseOffset} from './common';
import {getTimestamps} from '../parsers/common';
import {loadOxtsPackets} from '../parsers/parse-gps-data';

export default class GPSConverter {
  constructor(directory) {
    this.rootDir = directory;
    this.gpsDir = path.join(directory, 'oxts', 'data');

    // XVIZ stream names produced by this converter
    this.VEHICLE_ACCELERATION = '/vehicle/acceleration';
    this.VEHICLE_VELOCITY = '/vehicle/velocity';
    this.VEHICLE_TRAJECTORY = '/vehicle/trajectory';
  }

  load() {
    const timeFilePath = path.join(this.rootDir, 'oxts', 'timestamps.txt');

    this.timestamps = getTimestamps(timeFilePath);
    this.gpsFiles = fs.readdirSync(this.gpsDir).sort();

    // Load all files because we need them for the trajectory
    this.poses = this.gpsFiles.map((fileName, i) => {
      const srcFilePath = path.join(this.gpsDir, fileName);
      return this._convertPose(srcFilePath, this.timestamps[i]);
    });
  }

  getPose(frameNumber) {
    return this.poses[frameNumber].pose;
  }

  async convertFrame(frameNumber, xvizBuilder) {
    const i = frameNumber;
    const entry = this.poses[i];
    const pose = entry.pose;
    console.log(`processing gps data frame ${i}/${this.timestamps.length}`); // eslint-disable-line

    // Every frame *MUST* have a pose. The pose can be considered
    // the core reference point for other data and usually drives the timing
    // of the system.
    xvizBuilder.pose(pose);

    // This is an example of using the XVIZBuilder to convert your data
    // into XVIZ.
    //
    // The fluent-API makes this construction self-documenting.
    xvizBuilder
      .stream(this.VEHICLE_VELOCITY)
      .timestamp(entry.velocity.timestamp)
      .value(entry.velocity['velocity-forward'])

      .stream(this.VEHICLE_ACCELERATION)
      .timestamp(entry.acceleration.timestamp)
      .value(entry.acceleration['acceleration-forward']);

    const limit = this.poses.length;
    const getVehiclePose = index => this.poses[index].pose;

    const xvizTrajectory = generateTrajectoryFrame(
      i,
      limit,
      getVehiclePose,
      this._convertTrajectory
    );
    xvizBuilder.stream(this.VEHICLE_TRAJECTORY).polyline(xvizTrajectory);
  }

  getMetadata(xvizMetaBuilder) {
    // You can see the type of metadata we allow to define.
    // This helps validate data consistency and has automatic
    // behavior tied to the viewer.
    const xb = xvizMetaBuilder;
    xb.stream('vehicle-pose')
      .category('vehicle-pose')

      .stream(this.VEHICLE_ACCELERATION)
      .category('time_series')
      .type('float')
      .unit('m/s^2')

      .stream(this.VEHICLE_VELOCITY)
      .category('time_series')
      .type('float')
      .unit('m/s')

      .stream(this.VEHICLE_TRAJECTORY)
      .category('primitive')
      .type('polyline')

      // This styling information is applied to *all* objects for this stream.
      // It is possible to apply inline styling on individual objects.
      .styleClassDefault({
        strokeColor: '#57AD57AA',
        strokeWidth: 1.4,
        strokeWidthMinPixels: 1
      });
  }

  _convertPose(filePath, timestamp) {
    const fileContent = fs.readFileSync(filePath, 'utf8').split('\n')[0];

    const oxts = loadOxtsPackets(fileContent);
    return this._convertPoseEntry(oxts, timestamp);
  }

  // Convert raw data into properly parsed objects
  // @return {pose, velocity, acceleration}
  _convertPoseEntry(oxts, timestamp) {
    const {
      lat,
      lon,
      alt,
      roll,
      pitch,
      yaw,
      vn,
      ve,
      vf,
      vl,
      vu,
      ax,
      ay,
      az,
      af,
      al,
      au,
      wx,
      wy,
      wz,
      wf,
      wl,
      wu
    } = oxts;
    const resMap = {};

    resMap.pose = {
      time: timestamp,
      latitude: Number(lat),
      longitude: Number(lon),
      altitude: Number(alt),
      roll: Number(roll),
      pitch: Number(pitch),
      yaw: Number(yaw)
    };

    resMap.velocity = {
      timestamp,
      'velocity-north': Number(vn),
      'velocity-east': Number(ve),
      'velocity-forward': Number(vf),
      'velocity-left': Number(vl),
      'velocity-upward': Number(vu),
      'angular-rate-x': Number(wx),
      'angular-rate-y': Number(wy),
      'angular-rate-z': Number(wz),
      'angular-rate-forward': Number(wf),
      'angular-rate-left': Number(wl),
      'angular-rate-upward': Number(wu)
    };

    resMap.acceleration = {
      timestamp,
      'acceleration-x': Number(ax),
      'acceleration-y': Number(ay),
      'acceleration-z': Number(az),
      'acceleration-forward': Number(af),
      'acceleration-left': Number(al),
      'acceleration-upward': Number(au)
    };

    return resMap;
  }

  _convertTrajectory = motions => {
    const vertices = motions.map((m, i) => {
      return getPoseOffset(motions[0], m);
    });

    return vertices;
  };
}
